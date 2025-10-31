import { loadCatalog } from '../core/catalog.js';
import { evaluate } from '../core/engine.js';
import { validateRulesStructure } from '../core/rules.js';
import { qs } from '../core/utils.js';
import { addLocaleChangeListener, onLocaleReady, t } from '../core/i18n.js';
import { renderStage as renderStageView, refreshAnchorFeedback, setAnchorFeedbackEvaluator, setStageConnectionState, syncAnchorPlacements } from './stage-runtime.js';
import { runEvaluationAnimations as dispatchEvaluationAnimations, setAnimationTranslator } from './animations.js';
import { createAudioManager, setAudioTranslator } from './audio.js';

const STORED_SCENARIOS_KEY = 'uploadedScenarios';
const DEFAULT_SCENARIO_URL = 'scenarios/case01/scenario.json';

const statusEl = qs('#statusMessages');
const state = {
  scenario: null,
  catalog: null,
  placements: [],
  pendingDeviceId: null,
  connected: false,
  scenarioUrl: '',
  scenarioBase: '',
  availableRulesets: [],
  selectedRulesetIds: new Set(),
  correctRulesetIds: new Set(),
  audioManager: null
};

const boundAnchorElements = new WeakSet();

const AudioContextCtor = typeof globalThis !== 'undefined'
  ? (globalThis.AudioContext || globalThis.webkitAudioContext || null)
  : null;
let placementAudioContext = null;

setAnimationTranslator((key, params) => t(key, params));
setAudioTranslator((key, params) => t(key, params));

function translateOrDefault(key, fallback, params) {
  if (!key) {
    return fallback;
  }
  const result = t(key, params);
  if (typeof result === 'string' && result.length && result !== key) {
    return result;
  }
  return fallback;
}

function translateCatalogName(entry, fallback) {
  const base = typeof fallback === 'string' && fallback.length ? fallback : '';
  if (!entry?.nameKey) {
    return base;
  }
  return translateOrDefault(entry.nameKey, base);
}

function ensurePlacementAudioContext() {
  if (!AudioContextCtor) {
    return null;
  }
  if (!placementAudioContext) {
    placementAudioContext = new AudioContextCtor();
  }
  if (placementAudioContext.state === 'suspended') {
    placementAudioContext.resume().catch(() => {});
  }
  return placementAudioContext;
}

async function playPlacementSound() {
  const fallback = () => {
    const ctx = ensurePlacementAudioContext();
    if (!ctx) {
      return;
    }

    const startTime = ctx.currentTime;
    const duration = 0.08;

    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(420, startTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.35, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };

    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
  };

  if (state.audioManager) {
    try {
      const playback = state.audioManager.playPlacement();
      if (playback) {
        const { started } = playback;
        if (started && typeof started.then === 'function') {
          await started;
        }
        return;
      }
    } catch (error) {
      console.warn('Placement audio manager failed', error);
    }
  }

  fallback();
}

function normalizeScenarioRulesets(rawRulesets) {
  const entries = Array.isArray(rawRulesets) ? rawRulesets : [];
  const usedIds = new Set();
  let autoIndex = 1;

  return entries.reduce((acc, entry) => {
    if (!entry || typeof entry !== 'object') {
      return acc;
    }

    const text = typeof entry.text === 'string' ? entry.text.trim() : '';
    if (!text) {
      return acc;
    }

    let id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id) {
      while (usedIds.has(`ruleset-${autoIndex}`)) {
        autoIndex += 1;
      }
      id = `ruleset-${autoIndex}`;
      autoIndex += 1;
    }

    if (usedIds.has(id)) {
      let dedupe = 1;
      let candidate = `${id}-${dedupe}`;
      while (usedIds.has(candidate)) {
        dedupe += 1;
        candidate = `${id}-${dedupe}`;
      }
      id = candidate;
    }

    usedIds.add(id);

    const correct = (() => {
      if (entry.correct === true) {
        return true;
      }
      if (typeof entry.correct === 'string') {
        const normalized = entry.correct.trim().toLowerCase();
        return normalized === 'true' || normalized === '1';
      }
      if (typeof entry.correct === 'number') {
        return entry.correct === 1;
      }
      return false;
    })();

    acc.push({ id, text, correct });
    return acc;
  }, []);
}

function ensureSelectedRulesetSet() {
  if (!(state.selectedRulesetIds instanceof Set)) {
    state.selectedRulesetIds = new Set();
  }
  return state.selectedRulesetIds;
}

function ensureCorrectRulesetSet() {
  if (!(state.correctRulesetIds instanceof Set)) {
    state.correctRulesetIds = new Set();
  }
  return state.correctRulesetIds;
}

function getRulesetLabel(id) {
  if (!id) {
    return '';
  }
  const match = state.availableRulesets?.find?.((entry) => entry.id === id);
  return typeof match?.text === 'string' && match.text.trim() ? match.text.trim() : id;
}

function formatRulesetNames(ids, { fallback } = {}) {
  const source = Array.isArray(ids) ? ids : [];
  const labels = source
    .map((id) => getRulesetLabel(id))
    .map((label) => (typeof label === 'string' ? label.trim() : ''))
    .filter((label) => label.length > 0);
  if (!labels.length) {
    const defaultFallback = translateOrDefault('common.status.noneSelected', 'none selected');
    return typeof fallback === 'string' && fallback.length ? fallback : defaultFallback;
  }
  return labels.join(', ');
}

function formatLockedRulesetMessage(rulesetId, wasSelected) {
  const fallbackName = rulesetId || translateOrDefault('player.rulesets.nameFallback', 'ruleset');
  const rulesetName = getRulesetLabel(rulesetId) || fallbackName;
  const stateKey = wasSelected ? 'common.status.active' : 'common.status.inactive';
  const statusWord = translateOrDefault(stateKey, wasSelected ? 'active' : 'inactive');
  return translateOrDefault('player.rulesets.lockedMessage', `Connect devices before changing rulesets. "${rulesetName}" remains ${statusWord}.`, {
    name: rulesetName,
    state: statusWord
  });
}

function onRulesetCheckboxChange(event) {
  const checkbox = event.target;
  if (!checkbox || checkbox.type !== 'checkbox') {
    return;
  }

  const rulesetId = checkbox.dataset.rulesetId || checkbox.value;
  if (!rulesetId) {
    return;
  }

  const selectedSet = ensureSelectedRulesetSet();
  const wasSelected = selectedSet.has(rulesetId);
  if (!state.connected) {
    checkbox.checked = wasSelected;
    pushStatus(formatLockedRulesetMessage(rulesetId, wasSelected), 'warn');
    return;
  }

  const label = getRulesetLabel(rulesetId) || rulesetId;
  if (checkbox.checked) {
    selectedSet.add(rulesetId);
    pushStatus(translateOrDefault('player.rulesets.activated', `Activated ${label}.`, { label }), 'success');
  } else {
    selectedSet.delete(rulesetId);
    pushStatus(translateOrDefault('player.rulesets.deactivated', `Deactivated ${label}.`, { label }), 'info');
  }
}

function renderRulesets() {
  const form = qs('#rulesetControls');
  const list = qs('#rulesetList');
  const emptyMessage = qs('#rulesetEmptyMessage');
  if (!form || !list) {
    return;
  }

  if (!form.dataset.rulesetLockMessageBound) {
    form.addEventListener('click', (event) => {
      if (state.connected) {
        return;
      }
      const label = event.target.closest('.ruleset-controls__label');
      if (!label) {
        return;
      }
      const checkbox = label.querySelector('input[type="checkbox"]');
      if (!checkbox) {
        return;
      }
      event.preventDefault();
      const rulesetId = checkbox.dataset.rulesetId || checkbox.value;
      if (!rulesetId) {
        return;
      }
      const selectedSet = ensureSelectedRulesetSet();
      const wasSelected = selectedSet.has(rulesetId);
      pushStatus(formatLockedRulesetMessage(rulesetId, wasSelected), 'warn');
    });
    form.dataset.rulesetLockMessageBound = 'true';
  }

  list.innerHTML = '';
  const available = Array.isArray(state.availableRulesets) ? state.availableRulesets : [];
  const hasRulesets = available.length > 0;

  if (hasRulesets) {
    form.classList.remove('ruleset-controls--empty');
    if (emptyMessage) {
      emptyMessage.hidden = true;
    }
    list.hidden = false;
  } else {
    form.classList.add('ruleset-controls--empty');
    if (emptyMessage) {
      emptyMessage.hidden = false;
    }
    list.hidden = true;
    state.selectedRulesetIds = new Set();
    state.correctRulesetIds = new Set();
    updateRulesetInteractivity();
    return;
  }

  const selectedSet = ensureSelectedRulesetSet();
  const sanitizedSelection = new Set();
  available.forEach((entry) => {
    if (selectedSet.has(entry.id)) {
      sanitizedSelection.add(entry.id);
    }
  });
  state.selectedRulesetIds = sanitizedSelection;

  available.forEach((entry) => {
    const item = document.createElement('li');
    item.className = 'ruleset-controls__item';

    const label = document.createElement('label');
    label.className = 'ruleset-controls__label';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'rulesets';
    checkbox.value = entry.id;
    checkbox.dataset.rulesetId = entry.id;
    checkbox.checked = sanitizedSelection.has(entry.id);
    checkbox.addEventListener('change', onRulesetCheckboxChange);

    const text = document.createElement('span');
    text.className = 'ruleset-controls__text';
    text.textContent = entry.text;

    label.append(checkbox, text);
    item.appendChild(label);
    list.appendChild(item);
  });

  updateRulesetInteractivity();
}

function updateRulesetInteractivity() {
  const checkboxes = document.querySelectorAll('#rulesetList input[name="rulesets"]');
  const locked = !state.connected;
  checkboxes.forEach((checkbox) => {
    checkbox.disabled = locked;
    checkbox.classList.toggle('ruleset-controls__checkbox--locked', locked);
    const label = checkbox.closest('.ruleset-controls__label');
    if (label) {
      label.classList.toggle('ruleset-controls__label--locked', locked);
      if (locked) {
        label.setAttribute('title', translateOrDefault('player.rulesets.lockTooltip', 'Connect devices before changing rulesets.'));
      } else {
        label.removeAttribute('title');
      }
    }
    const item = checkbox.closest('.ruleset-controls__item');
    if (item) {
      item.classList.toggle('ruleset-controls__item--locked', locked);
    }
  });
}

function evaluateRulesetSelection() {

  const available = Array.isArray(state.availableRulesets) ? state.availableRulesets : [];
  const availableIds = new Set(available.map((entry) => entry.id));

  if (!available.length) {
    return {
      evaluated: false,
      matched: true,
      selectedIds: [],
      correctIds: [],
      missingIds: [],
      extraIds: [],
      selectedLabels: [],
      correctLabels: [],
      missingLabels: [],
      extraLabels: []
    };
  }

  const selectedSet = new Set();
  ensureSelectedRulesetSet().forEach((id) => {
    if (availableIds.has(id)) {
      selectedSet.add(id);
    }
  });
  state.selectedRulesetIds = new Set(selectedSet);

  const correctSet = new Set();
  ensureCorrectRulesetSet().forEach((id) => {
    if (availableIds.has(id)) {
      correctSet.add(id);
    }
  });
  state.correctRulesetIds = new Set(correctSet);

  const missingIds = Array.from(correctSet).filter((id) => !selectedSet.has(id));
  const extraIds = Array.from(selectedSet).filter((id) => !correctSet.has(id));
  const matched = missingIds.length === 0 && extraIds.length === 0 && correctSet.size === selectedSet.size;

  const toLabels = (ids) => ids.map((id) => getRulesetLabel(id)).filter((label) => label.length > 0);

  return {
    evaluated: true,
    matched,
    selectedIds: Array.from(selectedSet),
    correctIds: Array.from(correctSet),
    missingIds,
    extraIds,
    selectedLabels: toLabels(Array.from(selectedSet)),
    correctLabels: toLabels(Array.from(correctSet)),
    missingLabels: toLabels(missingIds),
    extraLabels: toLabels(extraIds)
  };
}

function syncConnectButton(button) {
  if (!button) {
    return;
  }
  const labelKey = state.connected
    ? 'player.page.buttons.disconnectAll'
    : 'player.page.buttons.connectAll';
  const fallbackLabel = state.connected ? 'Disconnect All' : 'Connect All';
  button.textContent = translateOrDefault(labelKey, fallbackLabel);
  button.setAttribute('aria-pressed', state.connected ? 'true' : 'false');
  const shouldLock = !state.connected && state.placements.length === 0;
  button.disabled = shouldLock;
  if (shouldLock) {
    button.setAttribute('aria-disabled', 'true');
    button.title = translateOrDefault('player.connect.tooltip', 'Place at least one device before connecting all.');
  } else {
    button.removeAttribute('aria-disabled');
    button.removeAttribute('title');
  }
}

function ensureStageVisibility() {
  const stage = qs('#playerStage');
  if (stage?.scrollIntoView) {
    stage.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
}

function setPendingDevice(deviceId) {
  state.pendingDeviceId = typeof deviceId === 'string' && deviceId ? deviceId : null;
  document.querySelectorAll('.device-card--pending').forEach((el) => {
    el.classList.remove('device-card--pending');
    el.removeAttribute('aria-current');
  });
  if (state.pendingDeviceId) {
    const cards = document.querySelectorAll('.device-card');
    cards.forEach((card) => {
      if (card.dataset.deviceId === state.pendingDeviceId) {
        card.classList.add('device-card--pending');
        card.setAttribute('aria-current', 'true');
      }
    });
  }
  refreshAnchorFeedback();
}

function getDeviceMeta(deviceId) {
  if (!state.catalog) {
    return null;
  }
  for (const category of state.catalog.categories || []) {
    const match = category.devices?.find?.((device) => device.id === deviceId);
    if (match) {
      return match;
    }
  }
  return null;
}

function findAnchor(anchorId) {
  return (state.scenario?.anchors || []).find((anchor) => anchor.id === anchorId) || null;
}

function formatPlacementNames(deviceId, anchorId) {
  const device = getDeviceMeta(deviceId);
  const anchor = findAnchor(anchorId);
  const deviceFallback = device?.name || deviceId || translateOrDefault('player.stage.deviceNameFallback', 'device');
  const deviceName = translateCatalogName(device, deviceFallback) || deviceFallback;
  const anchorName = anchor?.label || anchor?.id || translateOrDefault('player.stage.anchorNameFallback', 'anchor');
  return { deviceName, anchorName };
}

function evaluatePlacementAllowance(anchorId) {
  if (!state.pendingDeviceId) {
    return null;
  }
  const deviceId = state.pendingDeviceId;
  const anchor = findAnchor(anchorId);
  if (!anchor) {
    return { allowed: false };
  }

  const accepts = Array.isArray(anchor.accepts) ? anchor.accepts : [];
  if (accepts.length && !accepts.includes(deviceId)) {
    return { allowed: false };
  }

  const placementsForAnchor = state.placements.filter((entry) => entry.anchorId === anchorId);
  if (placementsForAnchor.length >= 4) {
    return { allowed: false };
  }

  if (placementsForAnchor.some((entry) => entry.deviceId === deviceId)) {
    return { allowed: false };
  }

  return { allowed: true };
}

function updateStagePlacements() {
  const enriched = state.placements.map((placement) => {
    const names = formatPlacementNames(placement.deviceId, placement.anchorId);
    const device = getDeviceMeta(placement.deviceId);
    const iconId = device?.icon ? String(device.icon).trim() : '';
    const iconUrl = iconId ? `assets/device-icons/${iconId}.png` : '';
    const fallbackLabelSource = names.deviceName || placement.deviceId || '';
    const fallbackLabel = fallbackLabelSource
      ? fallbackLabelSource.trim().charAt(0).toUpperCase()
      : '';
    return {
      ...placement,
      deviceName: names.deviceName,
      anchorName: names.anchorName,
      deviceIconId: iconId || null,
      deviceIconUrl: iconUrl || null,
      deviceFallbackLabel: fallbackLabel || null
    };
  });

  syncAnchorPlacements(enriched, {
    onRemove: ({ deviceId, anchorId }) => removePlacement(deviceId, anchorId)
  });

  refreshAnchorFeedback();

  const connectBtn = qs('#btnConnect');
  if (connectBtn) {
    syncConnectButton(connectBtn);
  }
}

function removePlacement(deviceId, anchorId) {
  const index = state.placements.findIndex(
    (entry) => entry.deviceId === deviceId && entry.anchorId === anchorId
  );
  if (index === -1) {
    return;
  }

  state.placements.splice(index, 1);
  const { deviceName, anchorName } = formatPlacementNames(deviceId, anchorId);
  pushStatus(translateOrDefault('player.placements.removed', `Removed ${deviceName} from ${anchorName}.`, {
    device: deviceName,
    anchor: anchorName
  }), 'info');
  updateStagePlacements();
  if (!state.connected && state.placements.length === 0) {
    pushStatus(translateOrDefault('player.placements.needsPlacement', 'Place at least one device to enable Connect All.'), 'warn');
  }
}

function attemptPlacement(deviceId, anchorId) {
  if (!deviceId) {
    pushStatus(translateOrDefault('player.placements.selectDeviceFirst', 'Select a device before choosing an anchor.'), 'warn');
    return false;
  }
  if (!anchorId) {
    pushStatus(translateOrDefault('player.placements.anchorNotRecognized', 'Anchor not recognized for placement.'), 'error');
    return false;
  }
  if (state.audioManager) {
    state.audioManager.unlock();
  }
  const anchor = findAnchor(anchorId);
  if (!anchor) {
    pushStatus(translateOrDefault('player.placements.anchorNotRecognized', 'Anchor not recognized for placement.'), 'error');
    return false;
  }

  const accepts = Array.isArray(anchor.accepts) ? anchor.accepts : [];
  if (accepts.length && !accepts.includes(deviceId)) {
    const { deviceName, anchorName } = formatPlacementNames(deviceId, anchorId);
    pushStatus(translateOrDefault('player.placements.deviceNotAllowed', `${deviceName} cannot be placed at ${anchorName}.`, {
      device: deviceName,
      anchor: anchorName
    }), 'warn');
    return false;
  }

  const placementsForAnchor = state.placements.filter((entry) => entry.anchorId === anchorId);
  if (placementsForAnchor.length >= 4) {
    const { anchorName } = formatPlacementNames(deviceId, anchorId);
    pushStatus(translateOrDefault('player.placements.anchorFull', `${anchorName} already has four devices placed.`, {
      anchor: anchorName
    }), 'warn');
    return false;
  }

  const existing = placementsForAnchor.find((entry) => entry.deviceId === deviceId);
  if (existing) {
    const { deviceName, anchorName } = formatPlacementNames(deviceId, anchorId);
    pushStatus(translateOrDefault('player.placements.deviceAlreadyPlaced', `${deviceName} is already placed at ${anchorName}.`, {
      device: deviceName,
      anchor: anchorName
    }), 'info');
    return false;
  }

  const hadPlacements = state.placements.length > 0;
  state.placements.push({ deviceId, anchorId });
  const { deviceName, anchorName } = formatPlacementNames(deviceId, anchorId);
  pushStatus(translateOrDefault('player.placements.placed', `Placed ${deviceName} at ${anchorName}.`, {
    device: deviceName,
    anchor: anchorName
  }), 'success');
  playPlacementSound();
  updateStagePlacements();
  if (!state.connected && !hadPlacements && state.placements.length > 0) {
    pushStatus(translateOrDefault('player.connect.connectAvailable', 'Connect All is now available.'), 'info');
  }
  return true;
}

function bindStageInteractions() {
  const anchors = document.querySelectorAll('.anchor-hit');
  anchors.forEach((anchorEl) => {
    if (boundAnchorElements.has(anchorEl)) {
      return;
    }
    boundAnchorElements.add(anchorEl);

    anchorEl.addEventListener('drop', (event) => {
      event.preventDefault();
      const deviceId = event.dataTransfer?.getData('application/x-device-id') || event.dataTransfer?.getData('text/plain') || state.pendingDeviceId;
      const anchorId = anchorEl.dataset.anchorId;
      attemptPlacement(deviceId, anchorId);
      setPendingDevice(null);
    });

    anchorEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      if (!state.pendingDeviceId) {
        return;
      }
      event.preventDefault();
      const anchorId = anchorEl.dataset.anchorId;
      attemptPlacement(state.pendingDeviceId, anchorId);
      setPendingDevice(null);
    });

    anchorEl.addEventListener('click', () => {
      if (!state.pendingDeviceId) {
        return;
      }
      const anchorId = anchorEl.dataset.anchorId;
      attemptPlacement(state.pendingDeviceId, anchorId);
      setPendingDevice(null);
    });
  });
}

function bindDeviceCardInteractions(card, device) {
  card.draggable = true;

  const selectDevice = ({ fromKeyboard = false } = {}) => {
    const alreadySelected = state.pendingDeviceId === device.id;
    if (fromKeyboard && !alreadySelected) {
      ensureStageVisibility();
    }
    setPendingDevice(alreadySelected ? null : device.id);
  };

  card.addEventListener('click', () => {
    selectDevice();
  });

  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectDevice({ fromKeyboard: true });
    }
  });

  card.addEventListener('dragstart', (event) => {
    setPendingDevice(device.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('application/x-device-id', device.id);
      event.dataTransfer.setData('text/plain', device.id);
    }
    card.classList.add('device-card--dragging');
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('device-card--dragging');
    setPendingDevice(null);
  });
}

async function init(){
  if (state.audioManager) {
    state.audioManager.reset();
    state.audioManager = null;
  }

  const params = new URL(location.href).searchParams;
  const storedSlotId = params.get('storedSlot');
  let scenarioInfo = null;

  if (storedSlotId) {
    scenarioInfo = loadScenarioFromStorage(storedSlotId);
    if (!scenarioInfo) {
      pushStatus(translateOrDefault('player.load.storedUnavailable', 'Stored scenario not available. Loading default sample scenario.'), 'warn');
    }
  }

  if (!scenarioInfo) {
    const requestedUrl = params.get('scenario') || DEFAULT_SCENARIO_URL;
    scenarioInfo = await loadScenarioFromUrl(requestedUrl);

    if (!scenarioInfo && requestedUrl !== DEFAULT_SCENARIO_URL) {
      pushStatus(translateOrDefault('player.load.fallbackToDefault', 'Falling back to default sample scenario.'), 'warn');
      scenarioInfo = await loadScenarioFromUrl(DEFAULT_SCENARIO_URL);
    }
  }

  if (!scenarioInfo) {
    pushStatus(translateOrDefault('player.load.unableToLoad', 'Unable to load a scenario.'), 'error');
    return;
  }

  state.scenario = scenarioInfo.scenario;
  state.scenarioUrl = scenarioInfo.url;
  state.scenarioBase = scenarioInfo.baseUrl;

  state.audioManager = createAudioManager(state.scenario?.audio, state.scenarioBase);

  if (state.scenario) {
    Object.defineProperty(state.scenario, '__baseUrl', {
      value: state.scenarioBase,
      enumerable: false,
      configurable: true
    });
  }

  state.availableRulesets = normalizeScenarioRulesets(state.scenario?.rulesets);
  state.correctRulesetIds = new Set(state.availableRulesets.filter((entry) => entry.correct).map((entry) => entry.id));
  state.selectedRulesetIds = new Set();
  state.connected = false;

  const catalogSource = state.scenario?.devicePool?.catalogSource || 'data/catalog/devices.json';
  state.catalog = await loadCatalog(catalogSource);
  state.placements = [];
  setPendingDevice(null);
  renderRulesets();
  renderAims();
  renderDeviceList();
  renderStageView(state.scenario);
  setStageConnectionState(state.connected);
  setAnchorFeedbackEvaluator(evaluatePlacementAllowance);
  updateStagePlacements();
  bindStageInteractions();
  bindUI();
  const fallbackTitle = translateOrDefault('common.status.untitledScenario', 'Untitled scenario');
  const scenarioTitle = state.scenario?.meta?.title || fallbackTitle;
  pushStatus(translateOrDefault('player.load.scenarioLoaded', `Scenario loaded: ${scenarioTitle}`, { title: scenarioTitle }));
}

function renderAims(){
  const ul = qs('#aimsList');
  if (!ul) {
    return;
  }
  ul.innerHTML = '';
  const aims = Array.isArray(state.scenario?.aims) ? state.scenario.aims : [];
  aims.forEach((aim) => {
    if (!aim) {
      return;
    }
    const li = document.createElement('li');
    if (typeof aim.id === 'string' && aim.id) {
      li.dataset.aimId = aim.id;
    }

    const marker = document.createElement('span');
    marker.className = 'aims__marker';
    marker.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'aims__text';
    text.textContent = typeof aim.text === 'string' ? aim.text : '';

    li.append(marker, text);
    ul.appendChild(li);
  });
}

function renderDeviceList(){
  const allowedIds = Array.isArray(state.scenario?.devicePool?.allowedDeviceIds)
    ? state.scenario.devicePool.allowedDeviceIds
    : [];
  const allowed = new Set(allowedIds);
  const list = qs('#deviceList');
  if (!list) {
    return;
  }
  list.innerHTML = '';
  const previousPending = state.pendingDeviceId;
  setPendingDevice(null);
  if (!state.catalog) {
    return;
  }
  state.catalog.categories.forEach(cat=>{
    const group = cat.devices.filter(d=>allowed.has(d.id));
    if(!group.length) return;
    const h = document.createElement('h3');
    const fallbackName = cat.name || cat.id || translateOrDefault('common.status.untitledFallback', 'Untitled');
    h.textContent = translateCatalogName(cat, fallbackName);
    list.appendChild(h);
    group.forEach(d=>{
      const card = document.createElement('div');
      card.className='device-card';
      card.tabIndex=0;
      card.dataset.deviceId = d.id;

      const icon = document.createElement('img');
      icon.className = 'device-card__icon';
      const fallbackLabel = d.name || d.id || translateOrDefault('player.stage.deviceFallback', 'Device');
      const deviceLabel = translateCatalogName(d, fallbackLabel) || fallbackLabel;
      icon.alt = deviceLabel;
      icon.loading = 'lazy';
      if (d.icon) {
        icon.src = `assets/device-icons/${d.icon}.png`;
        icon.addEventListener('error', () => {
          icon.classList.add('device-card__icon--missing');
          icon.removeAttribute('src');
          icon.alt = '';
          icon.setAttribute('aria-hidden', 'true');
        }, { once: true });
      } else {
        icon.classList.add('device-card__icon--missing');
        icon.alt = '';
        icon.setAttribute('aria-hidden', 'true');
      }

      const label = document.createElement('span');
      label.className = 'device-card__label';
      label.textContent = deviceLabel;

      card.append(icon, label);
      bindDeviceCardInteractions(card, d);
      list.appendChild(card);
    });
  });
  if (previousPending) {
    setPendingDevice(previousPending);
  }
}

function scenarioDir(rel){
  if(!rel) return '';
  const parts = rel.split('/');
  parts.pop();
  return parts.join('/');
}

function loadScenarioFromStorage(slotId) {
  const entry = getStoredScenarioEntry(slotId);
  if (!entry) {
    return null;
  }

  if (typeof entry.scenario !== 'object' || entry.scenario === null) {
    console.warn('Stored scenario entry missing scenario data', entry);
    return null;
  }

  try {
    const scenario = cloneScenarioData(entry.scenario);
    return {
      scenario,
      url: `stored:${slotId}`,
      baseUrl: `stored:${slotId}/`
    };
  } catch (error) {
    console.warn('Failed to load stored scenario', error);
    return null;
  }
}

async function loadScenarioFromUrl(url) {
  try {
    const scenario = await fetchScenarioData(url);
    return {
      scenario,
      url,
      baseUrl: scenarioDir(url)
    };
  } catch (error) {
    const errorMessage = error && typeof error.message === 'string' ? error.message : String(error);
    pushStatus(translateOrDefault('player.load.failedFromUrl', `Failed to load scenario from ${url}: ${errorMessage}`, {
      url,
      error: errorMessage
    }), 'error');
    console.error('Failed to load scenario from URL', error);
    return null;
  }
}

async function fetchScenarioData(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function getStoredScenarioEntry(slotId) {
  try {
    const raw = window.localStorage.getItem(STORED_SCENARIOS_KEY);
    if (!raw) {
      return null;
    }
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) {
      return null;
    }
    return entries.find((item) => item.id === slotId) || null;
  } catch (error) {
    console.warn('Failed to read stored scenarios', error);
    return null;
  }
}

function cloneScenarioData(data) {
  if (typeof structuredClone === 'function') {
    return structuredClone(data);
  }
  return JSON.parse(JSON.stringify(data));
}

function bindUI(){
  const connectBtn = qs('#btnConnect');
  if (connectBtn) {
    connectBtn.addEventListener('click', () => {
      state.connected = !state.connected;
      setStageConnectionState(state.connected);
      syncConnectButton(connectBtn);
      updateRulesetInteractivity();
      const selectedIds = Array.from(ensureSelectedRulesetSet());
      const summary = formatRulesetNames(selectedIds);
      const tone = state.connected ? 'success' : 'info';
      const verbKey = state.connected ? 'connected' : 'disconnected';
      const verb = translateOrDefault(`player.connect.verbs.${verbKey}`, verbKey);
      const lockMessage = state.connected
        ? translateOrDefault('player.rulesets.controlsUnlocked', 'Ruleset controls unlocked.')
        : translateOrDefault('player.rulesets.controlsLocked', 'Ruleset controls locked until devices are connected.');
      const message = translateOrDefault('player.connect.buttonStatus', `Devices ${verb}. ${lockMessage} Active rulesets: ${summary}.`, {
        verb,
        lockMessage,
        summary
      });
      pushStatus(message, tone);
      updateStagePlacements();
    });
    syncConnectButton(connectBtn);
    updateRulesetInteractivity();
  }

  const submitBtn = qs('#btnSubmit');
  if (submitBtn) {
    submitBtn.addEventListener('click', onSubmit);
  }

  const resetBtn = qs('#btnReset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => location.reload());
  }
}

function refreshLocaleDependentUI() {
  renderDeviceList();
  updateStagePlacements();
  const connectBtn = qs('#btnConnect');
  if (connectBtn) {
    syncConnectButton(connectBtn);
  }
  updateRulesetInteractivity();
}

async function onSubmit(){
  const validation = validateRulesStructure(state.scenario?.rules?.checks || []);
  if(!validation.ok){
    const fallbackMessage = translateOrDefault('player.status.rulesValidationFailed', 'Rules contain unsupported nested groups. Unable to evaluate.');
    const message = typeof validation.message === 'string' && validation.message.length ? validation.message : fallbackMessage;
    pushStatus(message, 'error');
    console.error('Rules validation failed', validation);
    return;
  }
  const outcome = evaluate(state.scenario, state.placements, state.connected);
  const rulesetResult = evaluateRulesetSelection();
  const { total, passed } = updateAimStatus(outcome);
  const messageParts = [];
  if (total > 0) {
    messageParts.push(translateOrDefault('player.status.evaluationCompleteWithCounts', `Evaluation complete: ${passed}/${total} aims satisfied.`, {
      passed,
      total
    }));
  } else {
    messageParts.push(translateOrDefault('player.status.evaluationComplete', 'Evaluation complete.'));
  }

  if (rulesetResult) {
    if (!rulesetResult.evaluated) {
      if (state.availableRulesets.length > 0) {
        messageParts.push(translateOrDefault('player.status.rulesetNotEvaluated', 'Ruleset selection not evaluated.'));
      } else {
        messageParts.push(translateOrDefault('player.status.noRulesets', 'No rulesets provided for this scenario.'));
      }
    } else if (rulesetResult.matched) {
      messageParts.push(translateOrDefault('player.status.rulesetCorrect', 'Ruleset selection correct.'));
    } else {
      const detailParts = [];
      if (rulesetResult.missingLabels.length) {
        detailParts.push(translateOrDefault('player.status.rulesetMissing', `missing: ${rulesetResult.missingLabels.join(', ')}`, {
          labels: rulesetResult.missingLabels.join(', ')
        }));
      }
      if (rulesetResult.extraLabels.length) {
        detailParts.push(translateOrDefault('player.status.rulesetUnexpected', `unexpected: ${rulesetResult.extraLabels.join(', ')}`, {
          labels: rulesetResult.extraLabels.join(', ')
        }));
      }
      const details = detailParts.length ? ` (${detailParts.join('; ')})` : '';
      messageParts.push(translateOrDefault('player.status.rulesetIncorrect', `Ruleset selection incorrect${details}.`, {
        details
      }));
    }
  }

  const message = messageParts.join(' ');

  let tone = 'info';
  if (total > 0 && passed === total && (rulesetResult?.matched !== false)) {
    tone = 'success';
  } else if (rulesetResult && rulesetResult.evaluated && !rulesetResult.matched) {
    tone = 'warn';
  } else if (total > 0 && passed < total) {
    tone = 'warn';
  }

  pushStatus(message.trim(), tone);

  const audioManager = state.audioManager;

  const awaitPlayback = async (playback, warningLabel) => {
    if (!playback) {
      return;
    }
    const { finished, started } = playback;
    let target = null;
    if (finished && typeof finished.then === 'function') {
      target = finished;
    } else if (started && typeof started.then === 'function') {
      target = started;
    }
    if (!target) {
      return;
    }
      try {
        await target;
      } catch (error) {
        if (warningLabel) {
          console.warn(warningLabel, error);
        }
      }
  };

  try {
    await dispatchEvaluationAnimations({
      aimOutcomes: outcome,
      rulesetResult,
      onAimReveal: async (entry) => {
        if (!audioManager) {
          return;
        }
        let playback = null;
        try {
          playback = audioManager.playAim({ passed: entry.result === 'pass' });
        } catch (error) {
          const aimWarning = translateOrDefault('player.audio.warnings.aimPlaybackFailed', 'Aim audio playback failed');
          console.warn(aimWarning, error);
          return;
        }
        if (!playback) {
          return;
        }
        return awaitPlayback(playback, translateOrDefault('player.audio.warnings.aimPlaybackFailed', 'Aim audio playback failed'));
      },
      onRulesetReveal: async () => {
        if (!audioManager || !rulesetResult) {
          return;
        }
        let playback = null;
        try {
          playback = audioManager.playRuleset({
            matched: rulesetResult.matched,
            evaluated: rulesetResult.evaluated
          });
        } catch (error) {
          const rulesetWarning = translateOrDefault('player.audio.warnings.rulesetPlaybackFailed', 'Ruleset audio playback failed');
          console.warn(rulesetWarning, error);
          return;
        }
        if (!playback) {
          return;
        }
        return awaitPlayback(playback, translateOrDefault('player.audio.warnings.rulesetPlaybackFailed', 'Ruleset audio playback failed'));
      }
    });
  } catch (error) {
    console.warn('Evaluation animation sequencing failed', error);
  }
}

function updateAimStatus(outcome){
  const list = qs('#aimsList');
  if (!list) {
    return { total: 0, passed: 0 };
  }
  const items = [...list.querySelectorAll('li')];
  let passed = 0;
  items.forEach((li)=>{
    li.classList.remove('aim-pass', 'aim-fail');
    delete li.dataset.aimResult;
    const marker = li.querySelector('.aims__marker');
    if (marker) {
      marker.textContent = '';
      marker.classList.remove('aims__marker--pass', 'aims__marker--fail');
      delete marker.dataset.status;
    }
    const aimId = li.dataset.aimId;
    if (!aimId) {
      return;
    }
    const result = outcome?.[aimId];
    if (result === true) {
      li.classList.add('aim-pass');
      li.dataset.aimResult = 'pass';
      if (marker) {
        marker.textContent = '✔';
        marker.classList.add('aims__marker--pass');
        marker.dataset.status = 'pass';
      }
      passed += 1;
    } else if (result === false) {
      li.classList.add('aim-fail');
      li.dataset.aimResult = 'fail';
      if (marker) {
        marker.textContent = '✖';
        marker.classList.add('aims__marker--fail');
        marker.dataset.status = 'fail';
      }
    }
  });
  return { total: items.length, passed };
}

function pushStatus(message, tone = 'info'){
  if (!statusEl) {
    return;
  }
  const entry = document.createElement('div');
  entry.className = `status-entry status-${tone}`;
  entry.textContent = message;
  statusEl.appendChild(entry);
  statusEl.scrollTop = statusEl.scrollHeight;
}

onLocaleReady()
  .then(() => init())
  .then(() => {
    refreshLocaleDependentUI();
    addLocaleChangeListener(() => {
      if (!state.scenario || !state.catalog) {
        return;
      }
      refreshLocaleDependentUI();
    });
  })
  .catch((error) => {
    console.error('Failed to initialize player app', error);
  });
