import { downloadJson, pickJsonFile } from '../core/storage.js';
import { validateScenario } from '../core/schema.js';
import { qs } from '../core/utils.js';
import { loadStageFromScenario } from './image-stage.js';
import { renderAimsEditor, renderRulesEditor, renderRulesetsEditor } from './aims-rules.js';

function showAlert(message) {
  if (typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert(message);
  } else {
    console.warn(message);
  }
}

function exportScenario(state) {
  const scenario = state?.scenario;
  if (!scenario) {
    showAlert('No scenario loaded to export.');
    return;
  }
  if (!Array.isArray(scenario.rulesets)) {
    scenario.rulesets = [];
  }
  downloadJson(scenario, 'scenario.json');
}

function handleScenarioImport(json, state, helpers) {
  const { hydrateScenario, persistScenarioDraft, renderCatalog } = helpers;
  if (!json) {
    return;
  }
  if (!validateScenario(json)) {
    showAlert('Invalid scenario file. Please choose a valid export.');
    return;
  }

  const nextScenario = typeof hydrateScenario === 'function'
    ? hydrateScenario(json)
    : json;

  if (!nextScenario) {
    showAlert('Unable to load the selected scenario file.');
    return;
  }

  state.scenario = nextScenario;

  if (typeof persistScenarioDraft === 'function') {
    persistScenarioDraft();
  }

  if (typeof renderCatalog === 'function') {
    renderCatalog();
  }

  loadStageFromScenario();
  renderAimsEditor();
  renderRulesEditor();
  renderRulesetsEditor();
}

export function initExportImport(state, helpers = {}) {
  const { hydrateScenario, persistScenarioDraft, renderCatalog } = helpers;

  const exportBtn = qs('#btnExport');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => exportScenario(state));
  }

  const importInput = qs('#importJson');
  if (!importInput) {
    return;
  }

  const armImportListener = () => {
    pickJsonFile(importInput)
      .then(json => {
        try {
          handleScenarioImport(json, state, { hydrateScenario, persistScenarioDraft, renderCatalog });
        } catch (err) {
          console.error('Scenario import failed', err);
          showAlert('Failed to import scenario. Please try again.');
        }
      })
      .catch(err => {
        console.error('Scenario import failed', err);
        showAlert('Failed to import scenario. Please ensure the file is valid.');
      })
      .finally(() => {
        importInput.value = '';
        armImportListener();
      });
  };

  armImportListener();
}
