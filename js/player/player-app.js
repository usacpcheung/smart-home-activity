import { loadCatalog } from '../core/catalog.js';
import { evaluate } from '../core/engine.js';
import { validateRulesStructure } from '../core/rules.js';
import { qs } from '../core/utils.js';
import { renderStage as renderStageView, refreshAnchorFeedback, setAnchorFeedbackEvaluator, syncAnchorPlacements } from './stage-runtime.js';

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
  scenarioBase: ''
};

const boundAnchorElements = new WeakSet();

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
  const deviceName = device?.name || deviceId || 'device';
  const anchorName = anchor?.label || anchor?.id || 'anchor';
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
  pushStatus(`Removed ${deviceName} from ${anchorName}.`, 'info');
  updateStagePlacements();
}

function attemptPlacement(deviceId, anchorId) {
  if (!deviceId) {
    pushStatus('Select a device before choosing an anchor.', 'warn');
    return false;
  }
  if (!anchorId) {
    pushStatus('Anchor not recognized for placement.', 'error');
    return false;
  }
  const anchor = findAnchor(anchorId);
  if (!anchor) {
    pushStatus('Anchor not recognized for placement.', 'error');
    return false;
  }

  const accepts = Array.isArray(anchor.accepts) ? anchor.accepts : [];
  if (accepts.length && !accepts.includes(deviceId)) {
    const { deviceName, anchorName } = formatPlacementNames(deviceId, anchorId);
    pushStatus(`${deviceName} cannot be placed at ${anchorName}.`, 'warn');
    return false;
  }

  const placementsForAnchor = state.placements.filter((entry) => entry.anchorId === anchorId);
  if (placementsForAnchor.length >= 4) {
    const { anchorName } = formatPlacementNames(deviceId, anchorId);
    pushStatus(`${anchorName} already has four devices placed.`, 'warn');
    return false;
  }

  const existing = placementsForAnchor.find((entry) => entry.deviceId === deviceId);
  if (existing) {
    const { deviceName, anchorName } = formatPlacementNames(deviceId, anchorId);
    pushStatus(`${deviceName} is already placed at ${anchorName}.`, 'info');
    return false;
  }

  state.placements.push({ deviceId, anchorId });
  const { deviceName, anchorName } = formatPlacementNames(deviceId, anchorId);
  pushStatus(`Placed ${deviceName} at ${anchorName}.`, 'success');
  updateStagePlacements();
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

  const selectDevice = () => {
    const alreadySelected = state.pendingDeviceId === device.id;
    setPendingDevice(alreadySelected ? null : device.id);
  };

  card.addEventListener('click', () => {
    selectDevice();
  });

  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectDevice();
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
  const params = new URL(location.href).searchParams;
  const storedSlotId = params.get('storedSlot');
  let scenarioInfo = null;

  if (storedSlotId) {
    scenarioInfo = loadScenarioFromStorage(storedSlotId);
    if (!scenarioInfo) {
      pushStatus('Stored scenario not available. Loading default sample scenario.', 'warn');
    }
  }

  if (!scenarioInfo) {
    const requestedUrl = params.get('scenario') || DEFAULT_SCENARIO_URL;
    scenarioInfo = await loadScenarioFromUrl(requestedUrl);

    if (!scenarioInfo && requestedUrl !== DEFAULT_SCENARIO_URL) {
      pushStatus('Falling back to default sample scenario.', 'warn');
      scenarioInfo = await loadScenarioFromUrl(DEFAULT_SCENARIO_URL);
    }
  }

  if (!scenarioInfo) {
    pushStatus('Unable to load a scenario.', 'error');
    return;
  }

  state.scenario = scenarioInfo.scenario;
  state.scenarioUrl = scenarioInfo.url;
  state.scenarioBase = scenarioInfo.baseUrl;

  if (state.scenario) {
    Object.defineProperty(state.scenario, '__baseUrl', {
      value: state.scenarioBase,
      enumerable: false,
      configurable: true
    });
  }

  const catalogSource = state.scenario?.devicePool?.catalogSource || 'data/catalog/devices.json';
  state.catalog = await loadCatalog(catalogSource);
  state.placements = [];
  setPendingDevice(null);
  renderAims();
  renderDeviceList();
  renderStageView(state.scenario);
  setAnchorFeedbackEvaluator(evaluatePlacementAllowance);
  updateStagePlacements();
  bindStageInteractions();
  bindUI();
  pushStatus('Scenario loaded: ' + (state.scenario?.meta?.title || 'untitled'));
}

function renderAims(){
  const ul = qs('#aimsList'); ul.innerHTML = '';
  (state.scenario.aims||[]).forEach(a=>{
    const li = document.createElement('li');
    li.textContent = a.text; li.dataset.aimId = a.id; ul.appendChild(li);
  });
}

function renderDeviceList(){
  const allowedIds = state.scenario?.devicePool?.allowedDeviceIds || [];
  const allowed = new Set(allowedIds);
  const list = qs('#deviceList'); list.innerHTML = '';
  setPendingDevice(null);
  state.catalog.categories.forEach(cat=>{
    const group = cat.devices.filter(d=>allowed.has(d.id));
    if(!group.length) return;
    const h = document.createElement('h3'); h.textContent = cat.name; list.appendChild(h);
    group.forEach(d=>{
      const card = document.createElement('div');
      card.className='device-card';
      card.tabIndex=0;
      card.dataset.deviceId = d.id;

      const icon = document.createElement('img');
      icon.className = 'device-card__icon';
      icon.alt = d.name;
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
      label.textContent = d.name;

      card.append(icon, label);
      bindDeviceCardInteractions(card, d);
      list.appendChild(card);
    });
  });
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
    pushStatus(`Failed to load scenario from ${url}: ${error.message}`, 'error');
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
  qs('#btnConnect').addEventListener('click', ()=>{ state.connected = true; pushStatus('Devices marked as connected.'); /* AI TODO: small glow animation */ });
  qs('#btnSubmit').addEventListener('click', onSubmit);
  qs('#btnReset').addEventListener('click', ()=>location.reload());
}

function onSubmit(){
  const validation = validateRulesStructure(state.scenario?.rules?.checks || []);
  if(!validation.ok){
    const message = validation.message || 'Rules contain unsupported nested groups. Unable to evaluate.';
    pushStatus(message, 'error');
    console.error('Rules validation failed', validation);
    return;
  }
  const outcome = evaluate(state.scenario, state.placements, state.connected);
  // AI TODO: call animations per aim (success/fail overlay); then mark aims ✔/✖ visually.
  const { total, passed } = updateAimStatus(outcome);
  if (total > 0) {
    const tone = passed === total ? 'success' : 'warn';
    pushStatus(`Evaluation complete: ${passed}/${total} aims satisfied.`, tone);
  } else {
    pushStatus('Evaluation complete.', 'info');
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
    const aimId = li.dataset.aimId;
    if (!aimId) {
      return;
    }
    const result = outcome?.[aimId];
    if (result === true) {
      li.classList.add('aim-pass');
      passed += 1;
    } else if (result === false) {
      li.classList.add('aim-fail');
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

init();
