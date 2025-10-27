import { loadCatalog } from '../core/catalog.js';
import { evaluate } from '../core/engine.js';
import { validateRulesStructure } from '../core/rules.js';
import { qs, qsa, log } from '../core/utils.js';
import { renderStage as renderStageView } from './stage-runtime.js';

const STORED_SCENARIOS_KEY = 'uploadedScenarios';
const DEFAULT_SCENARIO_URL = 'scenarios/case01/scenario.json';

const logEl = qs('#log');
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
      log(logEl, 'Stored scenario not available. Loading default sample scenario.');
    }
  }

  if (!scenarioInfo) {
    const requestedUrl = params.get('scenario') || DEFAULT_SCENARIO_URL;
    scenarioInfo = await loadScenarioFromUrl(requestedUrl);

    if (!scenarioInfo && requestedUrl !== DEFAULT_SCENARIO_URL) {
      log(logEl, 'Falling back to default sample scenario.');
      scenarioInfo = await loadScenarioFromUrl(DEFAULT_SCENARIO_URL);
    }
  }

  if (!scenarioInfo) {
    log(logEl, 'Unable to load a scenario.');
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
  log(logEl, 'Scenario loaded: ' + (state.scenario?.meta?.title || 'untitled'));
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
      const card = document.createElement('div'); card.className='device-card'; card.tabIndex=0;
      card.dataset.deviceId = d.id; card.textContent = d.name;
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
    log(logEl, `Failed to load scenario from ${url}: ${error.message}`);
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
  qs('#btnConnect').addEventListener('click', ()=>{ state.connected = true; log(logEl, 'Connect All pressed'); /* AI TODO: small glow animation */ });
  qs('#btnSubmit').addEventListener('click', onSubmit);
  qs('#btnReset').addEventListener('click', ()=>location.reload());
}

function onSubmit(){
  const validation = validateRulesStructure(state.scenario?.rules?.checks || []);
  if(!validation.ok){
    const message = validation.message || 'Rules contain unsupported nested groups. Unable to evaluate.';
    log(logEl, message);
    console.error('Rules validation failed', validation);
    return;
  }
  const outcome = evaluate(state.scenario, state.placements, state.connected);
  // AI TODO: call animations per aim (success/fail overlay); then mark aims ✔/✖ visually.
  Object.entries(outcome).forEach(([aimId, ok])=>{
    log(logEl, `${aimId}: ${ok?'PASS':'FAIL'}`);
  });
}

init();
