const CARD_STAGGER_MS = 180;
const activeTimers = new Set();
let activeSequenceToken = 0;
const sequenceCancelResolvers = new Set();
let overlayEl = null;

function clearTimeoutCompat(id) {
  const clear = typeof globalThis !== 'undefined' && typeof globalThis.clearTimeout === 'function'
    ? globalThis.clearTimeout.bind(globalThis)
    : (timeoutId) => clearTimeout(timeoutId);
  clear(id);
}

function cancelActiveSequence() {
  activeSequenceToken += 1;
  if (sequenceCancelResolvers.size === 0) {
    return activeSequenceToken;
  }
  const resolvers = Array.from(sequenceCancelResolvers);
  sequenceCancelResolvers.clear();
  resolvers.forEach((resolve) => {
    try {
      resolve();
    } catch (error) {
      console.warn('Evaluation animation cancel handler failed', error);
    }
  });
  return activeSequenceToken;
}

function clearSequenceState() {
  clearTimers();
  resetOverlay();
}

function ensureOverlayElement() {
  if (overlayEl && overlayEl.isConnected) {
    return overlayEl;
  }
  overlayEl = document.getElementById('overlay');
  return overlayEl;
}

function clearTimers() {
  for (const id of activeTimers) {
    clearTimeoutCompat(id);
  }
  activeTimers.clear();
}

function schedule(callback, delay = 0) {
  const set = typeof globalThis !== 'undefined' && typeof globalThis.setTimeout === 'function'
    ? globalThis.setTimeout.bind(globalThis)
    : (cb, ms) => setTimeout(cb, ms);
  const timeoutId = set(() => {
    activeTimers.delete(timeoutId);
    callback();
  }, Math.max(0, delay));
  activeTimers.add(timeoutId);
  return timeoutId;
}

function resetOverlay() {
  const overlay = ensureOverlayElement();
  if (!overlay) {
    return;
  }
  overlay.innerHTML = '';
  overlay.classList.remove('overlay--active');
  overlay.removeAttribute('data-animation-state');
  overlay.setAttribute('aria-hidden', 'true');
}

export function resetEvaluationAnimations() {
  cancelActiveSequence();
  clearSequenceState();
}

function textContentOrFallback(node, fallback = '') {
  if (!node) {
    return fallback;
  }
  const text = node.textContent;
  return typeof text === 'string' && text.trim().length ? text.trim() : fallback;
}

function createAimCard({ aimId, label, result, index }) {
  const card = document.createElement('article');
  card.className = 'aim-result-card';
  card.dataset.aimId = aimId || '';
  card.dataset.result = result;
  card.style.setProperty('--sequence-delay', `${Math.max(0, index) * CARD_STAGGER_MS}ms`);
  card.classList.add(result === 'pass' ? 'aim-result-card--pass' : 'aim-result-card--fail');

  const marker = document.createElement('span');
  marker.className = 'aim-result-card__marker';
  marker.setAttribute('aria-hidden', 'true');

  const body = document.createElement('div');
  body.className = 'aim-result-card__body';

  const title = document.createElement('p');
  title.className = 'aim-result-card__label';
  title.textContent = label || aimId || 'Aim';

  const status = document.createElement('p');
  status.className = 'aim-result-card__status';
  status.textContent = result === 'pass' ? 'Aim satisfied' : 'Aim not met';

  body.append(title, status);
  card.append(marker, body);
  return card;
}

function createRulesetVerdictCard(rulesetResult, index) {
  const card = document.createElement('article');
  card.className = 'ruleset-verdict';
  card.style.setProperty('--sequence-delay', `${Math.max(0, index) * CARD_STAGGER_MS}ms`);

  const marker = document.createElement('span');
  marker.className = 'ruleset-verdict__marker';
  marker.setAttribute('aria-hidden', 'true');

  const body = document.createElement('div');
  body.className = 'ruleset-verdict__body';

  let status = 'neutral';
  let headline = 'Ruleset selection not evaluated';
  let detail = '';

  if (!rulesetResult) {
    detail = 'No ruleset comparison was performed.';
  } else if (rulesetResult.evaluated !== true) {
    detail = 'Connect devices and try again to score your selection.';
  } else if (rulesetResult.matched) {
    status = 'pass';
    headline = 'Ruleset selection correct';
    detail = 'Your chosen combinations match the expected answer.';
  } else {
    status = 'fail';
    headline = 'Ruleset selection incorrect';
    const parts = [];
    if (Array.isArray(rulesetResult.missingLabels) && rulesetResult.missingLabels.length) {
      parts.push(`Missing: ${rulesetResult.missingLabels.join(', ')}`);
    }
    if (Array.isArray(rulesetResult.extraLabels) && rulesetResult.extraLabels.length) {
      parts.push(`Unexpected: ${rulesetResult.extraLabels.join(', ')}`);
    }
    detail = parts.join(' • ') || 'Review the expected combinations and adjust your picks.';
  }

  card.dataset.result = status;
  card.classList.add(`ruleset-verdict--${status}`);

  const title = document.createElement('p');
  title.className = 'ruleset-verdict__headline';
  title.textContent = headline;

  body.append(title);

  if (detail) {
    const detailEl = document.createElement('p');
    detailEl.className = 'ruleset-verdict__detail';
    detailEl.textContent = detail;
    body.append(detailEl);
  }

  card.append(marker, body);
  return card;
}

function collectAimResults(aimOutcomes = {}) {
  const listItems = Array.from(document.querySelectorAll('#aimsList li'));
  const seen = new Set();
  const results = [];

  listItems.forEach((item, index) => {
    const aimId = item.dataset.aimId || `aim-${index + 1}`;
    if (seen.has(aimId)) {
      return;
    }
    const value = aimOutcomes[aimId];
    if (value === true || value === false) {
      const label = textContentOrFallback(item.querySelector('.aims__text'), aimId);
      results.push({ aimId, label, result: value === true ? 'pass' : 'fail' });
    }
    seen.add(aimId);
  });

  for (const [aimId, value] of Object.entries(aimOutcomes)) {
    if (seen.has(aimId)) {
      continue;
    }
    if (value === true || value === false) {
      results.push({ aimId, label: aimId, result: value === true ? 'pass' : 'fail' });
    }
  }

  return results;
}

export async function runEvaluationAnimations({
  aimOutcomes = {},
  rulesetResult,
  onAimReveal,
  onRulesetReveal,
  aimRevealDelayMs = CARD_STAGGER_MS,
  rulesetRevealDelayMs = CARD_STAGGER_MS,
  postRevealHoldMs = 4600
} = {}) {
  const sequenceToken = cancelActiveSequence();
  clearSequenceState();

  const overlay = ensureOverlayElement();
  if (!overlay) {
    return;
  }

  const isCancelled = () => sequenceToken !== activeSequenceToken;

  const aimResults = collectAimResults(aimOutcomes);

  const waitForDelay = async (ms) => {
    const duration = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    if (duration <= 0) {
      return;
    }
    if (isCancelled()) {
      return;
    }
    await new Promise((resolve) => {
      let settled = false;
      let cancelHandler = null;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (cancelHandler) {
          sequenceCancelResolvers.delete(cancelHandler);
        }
      };
      const timeoutId = schedule(() => {
        finish();
        resolve();
      }, duration);
      if (timeoutId === undefined || timeoutId === null) {
        finish();
        resolve();
        return;
      }
      cancelHandler = () => {
        if (settled) {
          return;
        }
        if (activeTimers.has(timeoutId)) {
          activeTimers.delete(timeoutId);
          clearTimeoutCompat(timeoutId);
        }
        finish();
        resolve();
      };
      sequenceCancelResolvers.add(cancelHandler);
      if (isCancelled()) {
        cancelHandler();
      }
    });
  };

  const runStep = async (handler, args, fallbackDelay) => {
    if (isCancelled()) {
      return;
    }
    if (typeof handler === 'function') {
      let result;
      try {
        result = handler(...args);
      } catch (error) {
        console.warn('Evaluation animation callback failed', error);
        result = null;
      }
      if (isCancelled()) {
        return;
      }
      if (result && typeof result.then === 'function') {
        try {
          await result;
          return;
        } catch (error) {
          console.warn('Evaluation animation callback rejected', error);
        }
        if (isCancelled()) {
          return;
        }
      } else if (result) {
        return;
      }
    }

    await waitForDelay(fallbackDelay);
    if (isCancelled()) {
      return;
    }
  };

  overlay.classList.add('overlay--active');
  overlay.setAttribute('aria-hidden', 'false');

  let cardIndex = 0;

  for (const entry of aimResults) {
    if (isCancelled()) {
      return;
    }
    const card = createAimCard({ ...entry, index: cardIndex });
    overlay.appendChild(card);

    await runStep(onAimReveal, [entry, cardIndex, card], aimRevealDelayMs);
    if (isCancelled()) {
      return;
    }
    cardIndex += 1;
  }

  if (isCancelled()) {
    return;
  }
  const verdictCard = createRulesetVerdictCard(rulesetResult, cardIndex);
  overlay.appendChild(verdictCard);

  await runStep(onRulesetReveal, [rulesetResult, cardIndex, verdictCard], rulesetRevealDelayMs);

  if (isCancelled()) {
    return;
  }

  if (!overlay.children.length) {
    overlay.classList.remove('overlay--active');
    overlay.setAttribute('aria-hidden', 'true');
    return;
  }

  const holdDuration = Number.isFinite(postRevealHoldMs)
    ? Math.max(0, postRevealHoldMs)
    : 4600;

  if (isCancelled()) {
    return;
  }
  schedule(() => {
    overlay.classList.remove('overlay--active');
    overlay.setAttribute('aria-hidden', 'true');
    schedule(() => {
      overlay.innerHTML = '';
    }, 240);
  }, holdDuration);
}
