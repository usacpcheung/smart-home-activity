const SUPPORTED_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav']);
const ABSOLUTE_PROTOCOL_PATTERN = /^(?:[a-z]+:)?\/\//i;
const EXPLICIT_PROTOCOL_PATTERN = /^[a-z]+:\/\//i;

function normalizePath(path) {
  return typeof path === 'string' ? path.trim() : '';
}

function joinRelativePath(base, relative) {
  const baseParts = normalizePath(base)
    .split('/')
    .filter((part) => part.length > 0);
  const relParts = normalizePath(relative)
    .split('/');
  const stack = baseParts.slice();
  relParts.forEach((part) => {
    if (!part || part === '.') {
      return;
    }
    if (part === '..') {
      if (stack.length) {
        stack.pop();
      }
    } else {
      stack.push(part);
    }
  });
  return stack.join('/');
}

function hasSupportedExtension(path) {
  const normalized = normalizePath(path);
  if (!normalized) {
    return false;
  }
  const withoutQuery = normalized.split('?')[0].split('#')[0];
  const lower = withoutQuery.toLowerCase();
  for (const ext of SUPPORTED_AUDIO_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

function resolveAudioUrl(source, baseUrl) {
  const trimmedSource = normalizePath(source);
  if (!trimmedSource) {
    return '';
  }
  if (trimmedSource.startsWith('data:') || trimmedSource.startsWith('blob:')) {
    return trimmedSource;
  }
  if (trimmedSource.startsWith('/')) {
    return trimmedSource;
  }
  if (ABSOLUTE_PROTOCOL_PATTERN.test(trimmedSource)) {
    return trimmedSource;
  }
  if (trimmedSource.toLowerCase().startsWith('assets/')) {
    return trimmedSource;
  }
  const trimmedBase = normalizePath(baseUrl).replace(/\/+$/, '');
  const sanitizedSource = trimmedSource.replace(/^\/+/, '');
  if (!trimmedBase) {
    return sanitizedSource;
  }
  if (EXPLICIT_PROTOCOL_PATTERN.test(trimmedBase)) {
    try {
      const baseForUrl = trimmedBase.endsWith('/') ? trimmedBase : `${trimmedBase}/`;
      return new URL(trimmedSource, baseForUrl).href;
    } catch (error) {
      return `${trimmedBase}/${sanitizedSource}`;
    }
  }
  if (sanitizedSource.startsWith('./') || sanitizedSource.startsWith('../')) {
    return joinRelativePath(trimmedBase, sanitizedSource);
  }
  return `${trimmedBase}/${sanitizedSource}`;
}

function createClipCacheEntry(url, key, onClipError) {
  if (typeof Audio !== 'function') {
    return null;
  }
  const audio = new Audio();
  audio.preload = 'auto';
  audio.src = url;
  if (typeof onClipError === 'function') {
    audio.addEventListener('error', () => {
      onClipError(key, url);
    }, { once: true });
  }
  return audio;
}

function createAudioManager(manifest, baseUrl) {
  const clipSources = new Map();
  const audioCache = new Map();
  let currentClip = null;
  let unlockAttempted = false;

  function logMissingSource(key, reason) {
    console.warn(`Audio clip unavailable for ${key}: ${reason}.`);
  }

  function registerClip(key, relativePath) {
    const normalized = normalizePath(relativePath);
    if (!normalized) {
      if (relativePath !== undefined && relativePath !== null) {
        logMissingSource(key, 'missing path');
      }
      return;
    }
    const resolved = resolveAudioUrl(normalized, baseUrl);
    if (!resolved) {
      logMissingSource(key, 'missing path');
      return;
    }
    if (!hasSupportedExtension(resolved)) {
      logMissingSource(key, 'unsupported file type');
      return;
    }
    clipSources.set(key, resolved);
    ensureClip(resolved);
  }

  function keyFromUrl(url) {
    for (const [entryKey, entryUrl] of clipSources.entries()) {
      if (entryUrl === url) {
        return entryKey;
      }
    }
    return '';
  }

  function ensureClip(url) {
    if (!url) {
      return null;
    }
    if (audioCache.has(url)) {
      return audioCache.get(url);
    }
    const audio = createClipCacheEntry(url, keyFromUrl(url), (failedKey, failedUrl) => {
      const descriptor = failedKey || failedUrl;
      logMissingSource(descriptor, 'failed to load');
    });
    if (!audio) {
      return null;
    }
    const ready = new Promise((resolve, reject) => {
      const cleanup = () => {
        audio.removeEventListener('canplaythrough', onReady);
        audio.removeEventListener('error', onError);
      };
      const onReady = () => {
        cleanup();
        resolve(audio);
      };
      const onError = (event) => {
        cleanup();
        const error = event?.error instanceof Error
          ? event.error
          : new Error(`Failed to buffer audio clip: ${url}`);
        reject(error);
      };
      audio.addEventListener('canplaythrough', onReady, { once: true });
      audio.addEventListener('error', onError, { once: true });

      const haveEnoughData = typeof audio.HAVE_ENOUGH_DATA === 'number'
        ? audio.HAVE_ENOUGH_DATA
        : 4;
      if (typeof audio.readyState === 'number' && audio.readyState >= haveEnoughData) {
        cleanup();
        resolve(audio);
        return;
      }

      try {
        audio.load();
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(`Failed to load audio clip: ${url}`));
      }
    });
    ready.catch(() => {});
    audio.addEventListener('ended', () => {
      if (currentClip === audio) {
        currentClip = null;
      }
    });
    const entry = { audio, ready };
    audioCache.set(url, entry);
    return entry;
  }

  function stopClip(clip) {
    if (!clip) {
      return;
    }
    try {
      clip.pause();
    } catch (error) {
      // no-op
    }
    try {
      clip.currentTime = 0;
    } catch (error) {
      // no-op
    }
  }

  function playClipByKey(key) {
    const url = clipSources.get(key);
    if (!url) {
      return null;
    }
    const entry = ensureClip(url);
    if (!entry) {
      return null;
    }
    const { audio, ready } = entry;
    const playback = (async () => {
      if (currentClip && currentClip !== audio) {
        stopClip(currentClip);
        currentClip = null;
      }

      currentClip = audio;
      stopClip(audio);

      let playPromise;
      try {
        const playResult = audio.play();
        playPromise = playResult && typeof playResult.then === 'function'
          ? playResult
          : Promise.resolve();
      } catch (error) {
        if (currentClip === audio) {
          currentClip = null;
        }
        stopClip(audio);
        console.warn(`Audio playback threw for ${key}`, error);
        throw error;
      }

      const [readyResult, playbackResult] = await Promise.allSettled([
        ready,
        playPromise
      ]);

      if (readyResult.status === 'rejected') {
        if (currentClip === audio) {
          currentClip = null;
        }
        stopClip(audio);
        throw readyResult.reason;
      }

      if (playbackResult.status === 'rejected') {
        if (currentClip === audio) {
          currentClip = null;
        }
        stopClip(audio);
        console.warn(`Audio playback failed for ${key}`, playbackResult.reason);
        throw playbackResult.reason;
      }
    })();

    return playback;
  }

  function firstAvailableClip() {
    const preferredOrder = [
      'placement',
      'aim-pass',
      'aim-fail',
      'ruleset-pass',
      'ruleset-fail'
    ];
    for (const key of preferredOrder) {
      const url = clipSources.get(key);
      if (url) {
        const entry = ensureClip(url);
        return entry ? entry.audio : null;
      }
    }
    return null;
  }

  function unlock() {
    if (unlockAttempted) {
      return;
    }
    unlockAttempted = true;
    const clip = firstAvailableClip();
    if (!clip || currentClip) {
      return;
    }
    const previousVolume = clip.volume;
    const previousMuted = clip.muted;
    clip.volume = 0;
    clip.muted = true;
    let playResult;
    try {
      playResult = clip.play();
    } catch (error) {
      clip.volume = previousVolume;
      clip.muted = previousMuted;
      stopClip(clip);
      return;
    }
    const restore = () => {
      clip.volume = previousVolume;
      clip.muted = previousMuted;
      stopClip(clip);
    };
    if (playResult && typeof playResult.then === 'function') {
      playResult.then(restore).catch(restore);
    } else {
      restore();
    }
  }

  function playPlacement() {
    return playClipByKey('placement');
  }

  function playAim({ passed } = {}) {
    const key = passed === true ? 'aim-pass' : 'aim-fail';
    return playClipByKey(key);
  }

  function playRuleset({ matched, evaluated } = {}) {
    if (!evaluated) {
      return null;
    }
    const key = matched === false ? 'ruleset-fail' : 'ruleset-pass';
    return playClipByKey(key);
  }

  function reset() {
    stopClip(currentClip);
    currentClip = null;
  }

  registerClip('placement', manifest?.placement);
  registerClip('aim-pass', manifest?.aims?.pass);
  registerClip('aim-fail', manifest?.aims?.fail);
  registerClip('ruleset-pass', manifest?.rulesets?.pass);
  registerClip('ruleset-fail', manifest?.rulesets?.fail);

  return {
    playPlacement,
    playAim,
    playRuleset,
    unlock,
    reset
  };
}

export { createAudioManager };
