import { loadCatalog } from '../core/catalog.js';
import { t, addLocaleChangeListener } from '../core/i18n.js';
import { saveLocal, loadLocal } from '../core/storage.js';
import { qs } from '../core/utils.js';
import { initStage, renderAnchorsPanel } from './image-stage.js';
import {
  initAimsRules,
  renderAimsEditor,
  renderRulesEditor,
  renderRulesetsEditor,
  getRulesValidationState,
  showRulesNotice
} from './aims-rules.js';
import { initExportImport } from './export-import.js';

const state = {
  catalog: null,
  scenario: createDefaultScenario()
};

function createDefaultScenario() {
  return {
    schemaVersion: 1,
    meta: { id: 'untitled', title: 'New Scenario', author: '', createdAt: new Date().toISOString() },
    stage: { logicalWidth: 1920, logicalHeight: 1080, background: null },
    devicePool: { catalogSource: 'data/catalog/devices.json', allowedDeviceIds: [] },
    anchors: [],
    aims: [],
    rules: { requireConnectButton: true, checks: [] },
    rulesets: [],
    animations: { success: {}, fail: 'redBlink' },
    audio: {
      placement: 'assets/audio/placement.mp3',
      aims: {
        pass: 'assets/audio/aim-pass.mp3',
        fail: 'assets/audio/aim-fail.mp3'
      },
      rulesets: {
        pass: 'assets/audio/ruleset-pass.mp3',
        fail: 'assets/audio/ruleset-fail.mp3'
      }
    }
  };
}

function hydrateScenario(saved) {
  if (!saved) return createDefaultScenario();
  const base = createDefaultScenario();
  const isValidAudioPath = value => typeof value === 'string' && /\.(mp3|wav)$/i.test(value.trim());
  const normalizeClip = value => {
    if (value == null) return null;
    return isValidAudioPath(value) ? value.trim() : null;
  };
  const sanitizeAudioGroup = (group = {}, baseGroup = {}) => {
    const result = { ...baseGroup };
    if (!group || typeof group !== 'object') {
      return result;
    }
    Object.keys(baseGroup).forEach(key => {
      if (Object.prototype.hasOwnProperty.call(group, key)) {
        result[key] = normalizeClip(group[key]);
      }
    });
    return result;
  };
  const sanitizeAudio = (audio = {}) => {
    const baseAudio = base.audio;
    if (!audio || typeof audio !== 'object') {
      return baseAudio;
    }
    return {
      placement: Object.prototype.hasOwnProperty.call(audio, 'placement')
        ? normalizeClip(audio.placement)
        : baseAudio.placement,
      aims: sanitizeAudioGroup(audio.aims, baseAudio.aims),
      rulesets: sanitizeAudioGroup(audio.rulesets, baseAudio.rulesets)
    };
  };
  const normalizeRulesets = rulesets => {
    if (!Array.isArray(rulesets)) {
      return [];
    }

    const usedIds = new Set();
    let autoId = 1;

    return rulesets.reduce((acc, entry) => {
      if (!entry) return acc;

      const text = typeof entry.text === 'string' ? entry.text.trim() : '';
      if (!text) return acc;

      let id = typeof entry.id === 'string' ? entry.id.trim() : '';
      if (id) {
        if (usedIds.has(id)) {
          id = '';
        }
      }

      if (!id) {
        while (usedIds.has(`ruleset-${autoId}`)) {
          autoId += 1;
        }
        id = `ruleset-${autoId}`;
        autoId += 1;
      }

      usedIds.add(id);

      const correct = (() => {
        if (entry.correct === true) return true;
        if (typeof entry.correct === 'string') {
          return entry.correct.trim().toLowerCase() === 'true';
        }
        if (typeof entry.correct === 'number') {
          return entry.correct === 1;
        }
        return false;
      })();

      acc.push({
        id,
        text,
        correct
      });
      return acc;
    }, []);
  };

  const allowedIds = new Set(saved.devicePool?.allowedDeviceIds || base.devicePool.allowedDeviceIds);
  const sanitizedAnchors = Array.isArray(saved.anchors)
    ? saved.anchors.map(anchor => {
        const { isDistractor, ...rest } = anchor || {};
        const accepts = Array.isArray(rest.accepts)
          ? rest.accepts.filter(id => allowedIds.has(id))
          : [];
        return {
          ...rest,
          accepts
        };
      })
    : base.anchors;

  const { distractorIds, ...restPool } = saved.devicePool || {};
  const sanitizedRulesets = normalizeRulesets(saved.rulesets);
  const sanitizedAudio = sanitizeAudio(saved.audio);

  const scenario = {
    ...base,
    ...saved,
    meta: { ...base.meta, ...saved.meta },
    stage: { ...base.stage, ...saved.stage },
    devicePool: {
      ...base.devicePool,
      ...restPool,
      allowedDeviceIds: saved.devicePool?.allowedDeviceIds || base.devicePool.allowedDeviceIds
    },
    rules: { ...base.rules, ...saved.rules },
    animations: { ...base.animations, ...saved.animations },
    anchors: sanitizedAnchors,
    rulesets: sanitizedRulesets,
    audio: sanitizedAudio
  };

  return scenario;
}

function persistScenarioDraft() {
  saveLocal('scenario', state.scenario);
}

export function saveScenarioDraft({ warnOnInvalidRules = true } = {}) {
  persistScenarioDraft();
  if (warnOnInvalidRules) {
    const validation = typeof getRulesValidationState === 'function' ? getRulesValidationState() : null;
    if (validation && validation.ok === false) {
      const defaultMessage = 'Scenario saved, but rule validation reported issues. Review highlighted rules before exporting.';
      const translated = validation.message || t('editor.scenario.ruleValidationWarning');
      const warningMessage = translated && translated !== 'editor.scenario.ruleValidationWarning' ? translated : defaultMessage;
      showRulesNotice(warningMessage, 'warning', { duration: 6000 });
    }
  }
}

function setDeviceAllowed(deviceId, allowed) {
  const pool = state.scenario.devicePool;
  const allowedSet = new Set(pool.allowedDeviceIds);
  const anchors = state.scenario.anchors || [];
  const wasAllowed = allowedSet.has(deviceId);

  if (allowed) {
    if (!wasAllowed) {
      allowedSet.add(deviceId);
      anchors.forEach(anchor => {
        if (!Array.isArray(anchor.accepts)) {
          anchor.accepts = [];
        }
        if (!anchor.accepts.includes(deviceId)) {
          anchor.accepts.push(deviceId);
        }
      });
    }
  } else if (wasAllowed) {
    allowedSet.delete(deviceId);
    anchors.forEach(anchor => {
      if (Array.isArray(anchor.accepts)) {
        anchor.accepts = anchor.accepts.filter(id => id !== deviceId);
      }
    });
  }

  pool.allowedDeviceIds = Array.from(allowedSet);
}

async function init(){
  state.scenario = hydrateScenario(loadLocal('scenario'));
  persistScenarioDraft();
  state.catalog = await loadCatalog();
  renderCatalog();
  initStage(state, { persistScenarioDraft });
  initAimsRules(state, { persistScenarioDraft });
  initExportImport(state, { hydrateScenario, persistScenarioDraft, renderCatalog });
  bindManualSaveControl();
  addLocaleChangeListener(() => {
    renderCatalog();
    renderAimsEditor();
    renderRulesEditor();
    renderRulesetsEditor();
  });
  // Editor subsystems are ready once the catalog is loaded; subsequent modules
  // manage stage rendering, anchor editing, aims/rules authoring, import/export,
  // and manual save controls tied to local draft persistence.
}

function bindManualSaveControl(){
  const saveButton = qs('#btnSaveScenario');
  if(!saveButton) return;
  saveButton.addEventListener('click', () => {
    saveScenarioDraft();
  });
}
function renderCatalog(){
  const panel = qs('#catalogPanel');
  panel.innerHTML = '';
  if (!state.catalog) return;

  const allowedSet = new Set(state.scenario.devicePool.allowedDeviceIds);
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
    const categoryName = translateCatalogEntry(cat, cat.name || cat.id);
    headerText.textContent = categoryName;

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
      const resolvedName = translateCatalogEntry(d, d.name || d.id);
      const connectivityList = (d.connectivity || []).join(', ');
      const connectivityFallback = translateOrFallback('common.status.notAvailable', 'n/a');
      const connectivity = connectivityList || connectivityFallback;

      const nameNode = document.createElement('span');
      nameNode.textContent = resolvedName;

      const connectivityNode = document.createElement('small');
      connectivityNode.textContent = `(${connectivity})`;

      deviceName.appendChild(nameNode);
      deviceName.appendChild(document.createTextNode(' '));
      deviceName.appendChild(connectivityNode);

      deviceLabel.appendChild(deviceCheckbox);
      deviceLabel.appendChild(deviceName);

      row.appendChild(deviceLabel);
      wrap.appendChild(row);
    });

    panel.appendChild(wrap);
  });

  renderAnchorsPanel();
  renderRulesEditor();
}

function translateOrFallback(key, fallback){
  if(!key){
    return fallback;
  }
  const translated = t(key);
  if(translated && translated !== key){
    return translated;
  }
  return fallback;
}

function translateCatalogEntry(entry, fallback){
  if(!entry){
    return fallback;
  }
  if(entry.nameKey){
    return translateOrFallback(entry.nameKey, fallback);
  }
  return fallback;
}
init();
