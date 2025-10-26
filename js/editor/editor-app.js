import { loadCatalog } from '../core/catalog.js';
import { saveLocal, loadLocal, downloadJson, pickJsonFile } from '../core/storage.js';
import { qs } from '../core/utils.js';
import { initStage } from './image-stage.js';

const state = {
  catalog: null,
  scenario: createDefaultScenario()
};

function createDefaultScenario() {
  return {
    schemaVersion: 1,
    meta: { id: 'untitled', title: 'New Scenario', author: '', createdAt: new Date().toISOString() },
    stage: { logicalWidth: 1920, logicalHeight: 1080, background: null },
    devicePool: { catalogSource: 'data/catalog/devices.json', allowedDeviceIds: [], distractorIds: [] },
    anchors: [],
    aims: [],
    rules: { requireConnectButton: true, checks: [] },
    animations: { success: {}, fail: 'redBlink' }
  };
}

function hydrateScenario(saved) {
  if (!saved) return createDefaultScenario();
  const base = createDefaultScenario();
  return {
    ...base,
    ...saved,
    meta: { ...base.meta, ...saved.meta },
    stage: { ...base.stage, ...saved.stage },
    devicePool: {
      ...base.devicePool,
      ...(saved.devicePool || {}),
      allowedDeviceIds: saved.devicePool?.allowedDeviceIds || base.devicePool.allowedDeviceIds,
      distractorIds: saved.devicePool?.distractorIds || base.devicePool.distractorIds
    },
    rules: { ...base.rules, ...saved.rules },
    animations: { ...base.animations, ...saved.animations }
  };
}

function persistScenarioDraft() {
  saveLocal('scenario', state.scenario);
}

function setDeviceAllowed(deviceId, allowed) {
  const pool = state.scenario.devicePool;
  const allowedSet = new Set(pool.allowedDeviceIds);
  if (allowed) {
    allowedSet.add(deviceId);
  } else {
    allowedSet.delete(deviceId);
    pool.distractorIds = pool.distractorIds.filter(id => id !== deviceId);
  }
  pool.allowedDeviceIds = Array.from(allowedSet);
}

function setDeviceDistractor(deviceId, isDistractor) {
  const pool = state.scenario.devicePool;
  const distractorSet = new Set(pool.distractorIds);
  if (isDistractor) {
    if (!pool.allowedDeviceIds.includes(deviceId)) {
      setDeviceAllowed(deviceId, true);
    }
    distractorSet.add(deviceId);
  } else {
    distractorSet.delete(deviceId);
  }
  pool.distractorIds = Array.from(distractorSet);
}

async function init(){
  state.scenario = hydrateScenario(loadLocal('scenario'));
  persistScenarioDraft();
  state.catalog = await loadCatalog();
  renderCatalog();
  bindExportImport();
  initStage(state, { persistScenarioDraft });
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
  if (!state.catalog) return;

  const allowedSet = new Set(state.scenario.devicePool.allowedDeviceIds);
  const distractorSet = new Set(state.scenario.devicePool.distractorIds);

  state.catalog.categories.forEach(cat => {
    const wrap = document.createElement('section');
    wrap.className = 'catalog-category';

    const headerLabel = document.createElement('label');
    headerLabel.className = 'catalog-category__header';

    const catCheckbox = document.createElement('input');
    catCheckbox.type = 'checkbox';
    catCheckbox.id = `cat_${cat.id}`;

    const devicesInCategory = cat.devices || [];
    const totalDevices = devicesInCategory.length;
    const selectedDevices = devicesInCategory.filter(device => allowedSet.has(device.id)).length;

    if (totalDevices > 0) {
      catCheckbox.checked = selectedDevices === totalDevices;
      catCheckbox.indeterminate = selectedDevices > 0 && selectedDevices < totalDevices;
    } else {
      catCheckbox.checked = false;
    }

    catCheckbox.addEventListener('change', e => {
      devicesInCategory.forEach(device => setDeviceAllowed(device.id, e.target.checked));
      persistScenarioDraft();
      renderCatalog();
    });

    const headerText = document.createElement('span');
    headerText.textContent = cat.name;

    headerLabel.appendChild(catCheckbox);
    headerLabel.appendChild(headerText);
    wrap.appendChild(headerLabel);

    devicesInCategory.forEach(d => {
      const row = document.createElement('div');
      row.className = 'catalog-device';

      const deviceLabel = document.createElement('label');
      deviceLabel.className = 'catalog-device__allow';

      const deviceCheckbox = document.createElement('input');
      deviceCheckbox.type = 'checkbox';
      deviceCheckbox.checked = allowedSet.has(d.id);
      deviceCheckbox.id = `dev_${d.id}`;
      deviceCheckbox.addEventListener('change', e => {
        setDeviceAllowed(d.id, e.target.checked);
        persistScenarioDraft();
        renderCatalog();
      });

      const deviceName = document.createElement('span');
      const connectivity = (d.connectivity || []).join(', ') || 'n/a';
      deviceName.innerHTML = `${d.name} <small>(${connectivity})</small>`;

      deviceLabel.appendChild(deviceCheckbox);
      deviceLabel.appendChild(deviceName);

      const distractorLabel = document.createElement('label');
      distractorLabel.className = 'catalog-device__distractor';

      const distractorCheckbox = document.createElement('input');
      distractorCheckbox.type = 'checkbox';
      distractorCheckbox.checked = distractorSet.has(d.id);
      distractorCheckbox.disabled = !allowedSet.has(d.id);
      distractorCheckbox.addEventListener('change', e => {
        setDeviceDistractor(d.id, e.target.checked);
        persistScenarioDraft();
        renderCatalog();
      });

      const distractorText = document.createElement('span');
      distractorText.textContent = 'Mark as Distractor';

      distractorLabel.appendChild(distractorCheckbox);
      distractorLabel.appendChild(distractorText);

      row.appendChild(deviceLabel);
      row.appendChild(distractorLabel);
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
    state.scenario = hydrateScenario(json);
    persistScenarioDraft();
    renderCatalog();
    // AI TODO: re-render everything from imported scenario.
  });
}
init();
