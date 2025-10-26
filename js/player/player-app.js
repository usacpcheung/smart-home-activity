import { loadCatalog } from '../core/catalog.js';
import { evaluate } from '../core/engine.js';
import { validateRulesStructure } from '../core/rules.js';
import { qs, qsa, log } from '../core/utils.js';
import { renderStage as renderStageView } from './stage-runtime.js';

const logEl = qs('#log');
const state = {
  scenario: null,
  catalog: null,
  placements: [],
  connected: false,
  scenarioUrl: '',
  scenarioBase: ''
};

function getScenarioUrl(){
  const u = new URL(location.href);
  return u.searchParams.get('scenario') || 'scenarios/case01/scenario.json';
}

async function init(){
  const url = getScenarioUrl();
  state.scenarioUrl = url;
  state.scenarioBase = scenarioDir(url);
  state.scenario = await (await fetch(url)).json();
  if(state.scenario){
    Object.defineProperty(state.scenario, '__baseUrl', {
      value: state.scenarioBase,
      enumerable: false,
      configurable: true
    });
  }
  state.catalog = await loadCatalog(state.scenario.devicePool.catalogSource || 'data/catalog/devices.json');
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
