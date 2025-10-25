import { loadCatalog } from '../core/catalog.js';
import { evaluate } from '../core/engine.js';
import { qs, qsa, log } from '../core/utils.js';

const logEl = qs('#log');
const state = { scenario: null, catalog: null, placements: [], connected: false };

function getScenarioUrl(){
  const u = new URL(location.href);
  return u.searchParams.get('scenario') || 'scenarios/case01/scenario.json';
}

async function init(){
  const url = getScenarioUrl();
  state.scenario = await (await fetch(url)).json();
  state.catalog = await loadCatalog(state.scenario.devicePool.catalogSource || 'data/catalog/devices.json');
  renderAims(); renderDeviceList(); renderStage(); bindUI();
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

function renderStage(){
  const stage = qs('#playerStage'); stage.innerHTML='';
  const img = document.createElement('img');
  img.alt = 'Scenario Background'; img.src = scenarioPath(state.scenario.stage.background);
  img.className='bg'; img.style.width='100%'; img.style.height='auto';
  stage.appendChild(img);

  // AI TODO: when image loads, draw anchor hit areas at normalized coords (absolute positioned .anchor-hit)
  // AI TODO: allow dropping/placing device onto an anchor; store in state.placements = [{deviceId, anchorId}]
}

function scenarioPath(rel){ 
  const base = getScenarioUrl().split('/').slice(0,-1).join('/');
  return `${base}/${rel}`;
}

function bindUI(){
  qs('#btnConnect').addEventListener('click', ()=>{ state.connected = true; log(logEl, 'Connect All pressed'); /* AI TODO: small glow animation */ });
  qs('#btnSubmit').addEventListener('click', onSubmit);
  qs('#btnReset').addEventListener('click', ()=>location.reload());
}

function onSubmit(){
  const outcome = evaluate(state.scenario, state.placements, state.connected);
  // AI TODO: call animations per aim (success/fail overlay); then mark aims ✔/✖ visually.
  Object.entries(outcome).forEach(([aimId, ok])=>{
    log(logEl, `${aimId}: ${ok?'PASS':'FAIL'}`);
  });
}

init();
