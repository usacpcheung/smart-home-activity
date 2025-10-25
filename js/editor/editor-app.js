import { loadCatalog } from '../core/catalog.js';
import { saveLocal, loadLocal, downloadJson, pickJsonFile } from '../core/storage.js';
import { qs, log } from '../core/utils.js';

const state = {
  catalog: null,
  scenario: {
    schemaVersion: 1,
    meta: { id: 'untitled', title: 'New Scenario', author: '', createdAt: new Date().toISOString() },
    stage: { logicalWidth: 1920, logicalHeight: 1080, background: null },
    devicePool: { catalogSource: 'data/catalog/devices.json', allowedDeviceIds: [], distractorIds: [] },
    anchors: [],
    aims: [],
    rules: { requireConnectButton: true, checks: [] },
    animations: { success: {}, fail: 'redBlink' }
  }
};

async function init(){
  state.catalog = await loadCatalog();
  renderCatalog();
  bindExportImport();
  // AI TODO:
  // 1) implement image-stage loader (bgUpload → draw in #stage; store stage.background as filename)
  // 2) click-to-add anchors in stage (store normalized coords)
  // 3) anchors panel CRUD (label, type, accepts[], isDistractor)
  // 4) aims & rules editors (create checks per aim)
  // 5) persist scenario draft in localStorage
}
function renderCatalog(){
  const panel = qs('#catalogPanel');
  panel.innerHTML = '';
  state.catalog.categories.forEach(cat=>{
    const wrap = document.createElement('div');
    wrap.innerHTML = `<h3>${cat.name}</h3>`;
    cat.devices.forEach(d=>{
      const id = `dev_${d.id}`;
      const row = document.createElement('label');
      row.style.display='block';
      row.innerHTML = `<input type="checkbox" id="${id}"> ${d.name} <small>(${(d.connectivity||[]).join(',')||'n/a'})</small>`;
      row.querySelector('input').addEventListener('change', e=>{
        const list = state.scenario.devicePool.allowedDeviceIds;
        if(e.target.checked){ if(!list.includes(d.id)) list.push(d.id); }
        else { state.scenario.devicePool.allowedDeviceIds = list.filter(x=>x!==d.id); }
        saveLocal('scenario', state.scenario);
      });
      wrap.appendChild(row);
    });
    panel.appendChild(wrap);
  });
}
function bindExportImport(){
  qs('#btnExport').addEventListener('click', ()=>{
    downloadJson(state.scenario, 'scenario.json');
  });
  pickJsonFile(qs('#importJson')).then(json=>{
    if(!json) return;
    state.scenario = json;
    // AI TODO: re-render everything from imported scenario.
  });
}
init();
