import { loadCatalog } from '../core/catalog.js';
import { evaluate } from '../core/engine.js';
import { validateRulesStructure } from '../core/rules.js';
import { qs } from '../core/utils.js';
import { renderStage as renderStageView } from './stage-runtime.js';

const STORED_SCENARIOS_KEY = 'uploadedScenarios';
const DEFAULT_SCENARIO_URL = 'scenarios/case01/scenario.json';

const statusEl = qs('#statusMessages');
const state = {
  scenario: null,
  catalog: null,
  placements: [],
  connected: false,
  scenarioUrl: '',
  scenarioBase: ''
};

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
  renderAims(); renderDeviceList(); renderStageView(state.scenario); bindUI();
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
  const allowed = new Set(state.scenario.devicePool.allowedDeviceIds || []);
  const list = qs('#deviceList'); list.innerHTML = '';
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
      // AI TODO: add dragstart handlers or “Place here” keyboard flow.
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
