import { addLocaleChangeListener, getCurrentLocale, onLocaleReady, t } from '../core/i18n.js';
import { I18N_CONFIG } from '../core/i18n-config.js';
import { appendLocaleToUrl, getStoredLocale, getLocaleFromQuery } from '../core/locale-preferences.js';

const STORAGE_KEY = 'uploadedScenarios';
const MAX_ENTRIES = 3;
const SAMPLE_SCENARIO_ID = 'sample-scenario';
const SAMPLE_SCENARIO_URL = 'scenarios/case01/scenario.json';
const SAMPLE_SCENARIO_FILENAME = 'scenarios/case01/scenario.json';

const uploadInput = document.getElementById('scenarioUpload');
const feedbackEl = document.getElementById('scenarioUploadFeedback');
const tableEl = document.getElementById('storedScenariosTable');
const tableBodyEl = document.getElementById('storedScenariosBody');
const emptyStateEl = document.getElementById('storedScenariosEmpty');

let sampleScenarioEntry = null;
let sampleScenarioLoadPromise = null;

function initializeScenarioTable() {
  if (!tableEl) {
    return;
  }

  if (emptyStateEl) {
    emptyStateEl.hidden = false;
    emptyStateEl.textContent = t('index.scenarioStorage.loadingSample');
  }

  renderStoredScenarios();

  if (sampleScenarioLoadPromise) {
    return;
  }

  sampleScenarioLoadPromise = loadSampleScenario()
    .catch((error) => {
      console.warn('Failed to load sample scenario', error);
      sampleScenarioEntry = null;
      setFeedback(t('index.scenarioStorage.sampleLoadError'), 'error');
      if (emptyStateEl) {
        emptyStateEl.hidden = false;
        emptyStateEl.textContent = t('index.scenarioStorage.sampleUnavailable');
      }
    })
    .finally(() => {
      renderStoredScenarios();
    });
}

async function loadSampleScenario() {
  try {
    const response = await fetch(SAMPLE_SCENARIO_URL, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const rawScenario = await response.json();
    const { errors, scenario } = validateAndNormalize(rawScenario);

    if (errors.length > 0 || !scenario) {
      throw new Error(errors.join(' ') || t('index.scenarioStorage.errors.sampleInvalid'));
    }

    sampleScenarioEntry = {
      id: SAMPLE_SCENARIO_ID,
      title: scenario.meta.title || t('common.status.sampleScenario'),
      uploadedAt: null,
      filename: SAMPLE_SCENARIO_FILENAME,
      scenario,
      isSample: true
    };

    return sampleScenarioEntry;
  } catch (error) {
    throw error;
  }
}

const storageAvailable = (() => {
  try {
    const probeKey = `${STORAGE_KEY}__probe`;
    window.localStorage.setItem(probeKey, '1');
    window.localStorage.removeItem(probeKey);
    return true;
  } catch (error) {
    setFeedback(t('index.scenarioStorage.storageUnavailable'), 'error');
    return false;
  }
})();

if (tableEl) {
  tableEl.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.dataset.action;
    if (!action) {
      return;
    }

    const row = target.closest('tr[data-entry-id]');
    const entryId = row?.dataset.entryId;
    if (!entryId) {
      return;
    }

    if (action === 'play') {
      handlePlay(entryId);
    } else if (action === 'clear') {
      handleClear(entryId);
    } else if (action === 'edit-title') {
      handleEditTitle(entryId);
    }
  });
}

initializeScenarioTable();

window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY) {
    renderStoredScenarios();
  }
});

if (tableEl) {
  onLocaleReady()
    .then(() => {
      renderStoredScenarios();
    })
    .catch((error) => {
      console.error('Failed to refresh stored scenarios after locale initialization', error);
    });

  addLocaleChangeListener(() => {
    renderStoredScenarios();
  });
}

if (uploadInput) {
  uploadInput.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    setFeedback(t('index.scenarioStorage.readingFile'), 'info');

    try {
      const text = await readFileAsText(file);
      const rawScenario = JSON.parse(text);
      const { errors, scenario, notes } = validateAndNormalize(rawScenario);

      if (errors.length > 0) {
        const reason = errors.join(' ');
        setFeedback(t('index.scenarioStorage.uploadFailed', { reason }), 'error');
      } else if (!storageAvailable) {
        setFeedback(t('index.scenarioStorage.storageUnavailableSave'), 'error');
      } else {
        const chosenTitle = promptForTitle(scenario.meta.title, t('index.scenarioStorage.promptTitle'));
        if (chosenTitle === null) {
          setFeedback(t('index.scenarioStorage.uploadCanceled'), 'info');
          return;
        }

        scenario.meta.title = chosenTitle;

        const { slotIndex, entries } = storeScenario(scenario, file.name);
        renderStoredScenarios(entries);
        const noteSuffix = notes.length > 0 ? ` ${notes.join(' ')}` : '';
        setFeedback(t('index.scenarioStorage.savedToSlot', {
          title: scenario.meta.title,
          slot: slotIndex + 1
        }) + noteSuffix, 'success');
      }
    } catch (error) {
      const reason = error instanceof SyntaxError
        ? t('index.scenarioStorage.invalidJson')
        : (error && typeof error.message === 'string' && error.message.length > 0
          ? error.message
          : t('index.scenarioStorage.unexpectedError'));
      setFeedback(t('index.scenarioStorage.uploadFailed', { reason }), 'error');
    } finally {
      // Reset so the same file can be uploaded again if needed.
      event.target.value = '';
    }
  });
}

function handlePlay(entryId) {
  if (entryId === SAMPLE_SCENARIO_ID) {
    if (!sampleScenarioEntry) {
      setFeedback(t('index.scenarioStorage.sampleUnavailableShort'), 'error');
      return;
    }

    const locale = resolveActiveLocale();
    const destination = appendLocaleToUrl(`player.html?scenario=${encodeURIComponent(SAMPLE_SCENARIO_URL)}`, locale);
    window.location.href = destination;
    return;
  }

  if (!storageAvailable) {
    setFeedback(t('index.scenarioStorage.storageUnavailablePlay'), 'error');
    return;
  }

  const entry = getStoredScenario(entryId);
  if (!entry) {
    setFeedback(t('index.scenarioStorage.missingEntry'), 'error');
    renderStoredScenarios();
    return;
  }

  const locale = resolveActiveLocale();
  const destination = appendLocaleToUrl(`player.html?storedSlot=${encodeURIComponent(entry.id)}`, locale);
  window.location.href = destination;
}

function handleClear(entryId) {
  if (entryId === SAMPLE_SCENARIO_ID) {
    setFeedback(t('index.scenarioStorage.sampleCannotBeCleared'), 'info');
    return;
  }

  if (!storageAvailable) {
    setFeedback(t('index.scenarioStorage.storageUnavailableClear'), 'error');
    return;
  }

  const entry = getStoredScenario(entryId);
  if (!entry) {
    setFeedback(t('index.scenarioStorage.slotEmpty'), 'info');
    renderStoredScenarios();
    return;
  }

  const entries = removeScenario(entryId);
  renderStoredScenarios(entries);
  const title = entry.title || t('common.status.untitledScenario');
  setFeedback(t('index.scenarioStorage.clearedFromStorage', { title }), 'info');
}

function handleEditTitle(entryId) {
  const isSample = entryId === SAMPLE_SCENARIO_ID;

  if (isSample && !sampleScenarioEntry) {
    setFeedback(t('index.scenarioStorage.sampleUnavailableShort'), 'error');
    return;
  }

  let currentTitle = t('common.status.untitledScenario');
  if (isSample) {
    currentTitle = sampleScenarioEntry.title || currentTitle;
  } else {
    const storedEntry = getStoredScenario(entryId);
    if (!storedEntry) {
      setFeedback(t('index.scenarioStorage.missingEntry'), 'error');
      renderStoredScenarios();
      return;
    }
    currentTitle = storedEntry.title || currentTitle;
  }

  const updatedTitle = promptForTitle(currentTitle, t('index.scenarioStorage.updateTitlePrompt'));
  if (updatedTitle === null) {
    setFeedback(t('index.scenarioStorage.titleUpdateCanceled'), 'info');
    return;
  }

  if (isSample) {
    sampleScenarioEntry.title = updatedTitle;
    if (sampleScenarioEntry.scenario?.meta) {
      sampleScenarioEntry.scenario.meta.title = updatedTitle;
    }
    renderStoredScenarios();
    setFeedback(t('index.scenarioStorage.sampleRenamed', { title: updatedTitle }), 'success');
    return;
  }

  const updatedEntries = updateStoredScenarioTitle(entryId, updatedTitle);
  if (!updatedEntries) {
    setFeedback(t('index.scenarioStorage.renameFailed'), 'error');
    return;
  }

  renderStoredScenarios(updatedEntries);
  setFeedback(t('index.scenarioStorage.scenarioRenamed', { title: updatedTitle }), 'success');
}

function renderStoredScenarios(entriesOverride) {
  if (!tableEl || !tableBodyEl || !emptyStateEl) {
    return;
  }

  const storedEntries = storageAvailable
    ? (Array.isArray(entriesOverride) ? entriesOverride : loadStoredScenarios())
    : [];
  const displayEntries = getDisplayEntries(storedEntries);
  tableBodyEl.innerHTML = '';

  const sampleLoading = Boolean(sampleScenarioLoadPromise) && !sampleScenarioEntry;

  if (!displayEntries.length) {
    tableEl.hidden = true;
    emptyStateEl.hidden = false;
    if (sampleLoading) {
      emptyStateEl.textContent = t('index.scenarioStorage.loadingSample');
    } else {
      emptyStateEl.textContent = storageAvailable
        ? t('index.scenarioStorage.emptyStates.none')
        : t('index.scenarioStorage.storageUnavailableList');
    }
    return;
  }

  tableEl.hidden = false;
  emptyStateEl.hidden = true;

  displayEntries.forEach((entry, index) => {
    const row = document.createElement('tr');
    row.dataset.entryId = entry.id;

    row.appendChild(createCell(String(index + 1)));
    row.appendChild(createCell(entry.title || t('common.status.untitledFallback')));
    row.appendChild(createCell(entry.filename || t('common.status.notProvided')));
    row.appendChild(createCell(formatUploadedAt(entry.uploadedAt)));

    const actionsCell = document.createElement('td');
    actionsCell.className = 'stored-scenarios-actions';
    actionsCell.appendChild(createActionButton(t('index.scenarioStorage.actions.editTitle'), 'edit-title'));
    actionsCell.appendChild(createActionButton(t('index.scenarioStorage.actions.play'), 'play'));

    const clearButton = createActionButton(t('index.scenarioStorage.actions.clear'), 'clear', entry.isSample ? {
      disabled: true,
      title: t('index.scenarioStorage.sampleCannotBeCleared')
    } : undefined);
    actionsCell.appendChild(clearButton);
    row.appendChild(actionsCell);

    tableBodyEl.appendChild(row);
  });
}

function getDisplayEntries(storedEntries) {
  const entries = Array.isArray(storedEntries) ? storedEntries.slice(0, MAX_ENTRIES) : [];

  if (!sampleScenarioEntry) {
    return entries;
  }

  const withoutSample = entries.filter((entry) => entry.id !== SAMPLE_SCENARIO_ID);
  return [sampleScenarioEntry, ...withoutSample];
}

function setFeedback(message, state = 'info') {
  if (!feedbackEl) {
    return;
  }
  feedbackEl.textContent = message;
  feedbackEl.dataset.state = state;
}

function createCell(text) {
  const cell = document.createElement('td');
  cell.textContent = text;
  return cell;
}

function createActionButton(label, action, options = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn';
  button.dataset.action = action;
  button.textContent = label;

  if (options && typeof options === 'object') {
    if (options.disabled) {
      button.disabled = true;
    }
    if (typeof options.title === 'string' && options.title.length > 0) {
      button.title = options.title;
    }
  }
  return button;
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error(t('index.scenarioStorage.fileReadError')));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'utf-8');
  });
}

function validateAndNormalize(rawScenario) {
  const errors = [];
  const notes = [];

  if (typeof rawScenario !== 'object' || rawScenario === null) {
    errors.push(t('index.scenarioStorage.errors.invalidScenarioObject'));
    return { errors, scenario: null, notes };
  }

  const scenario = cloneScenario(rawScenario);

  if (typeof scenario.meta !== 'object' || scenario.meta === null) {
    scenario.meta = {};
  }

  const title = scenario.meta.title;
  if (typeof title !== 'string' || title.trim().length === 0) {
    errors.push(t('index.scenarioStorage.errors.missingMetaTitle'));
  } else {
    scenario.meta.title = title.trim();
  }

  if (typeof scenario.stage !== 'object' || scenario.stage === null) {
    scenario.stage = {};
  }

  const background = scenario.stage.background;
  if (typeof background !== 'string' || background.trim().length === 0) {
    errors.push(t('index.scenarioStorage.errors.missingStageBackground'));
  } else {
    const { value, note, error } = normalizeBackground(background);
    if (error) {
      errors.push(error);
    } else {
      scenario.stage.background = value;
      if (note) {
        notes.push(note);
      }
    }
  }

  if (typeof scenario.devicePool !== 'object' || scenario.devicePool === null) {
    errors.push(t('index.scenarioStorage.errors.missingDevicePool'));
  } else if (!Array.isArray(scenario.devicePool.allowedDeviceIds)) {
    errors.push(t('index.scenarioStorage.errors.missingAllowedIds'));
  }

  return { errors, scenario, notes };
}

function normalizeBackground(background) {
  const trimmed = background.trim();
  if (/^(data:|blob:)/i.test(trimmed)) {
    return { value: trimmed };
  }

  try {
    const absoluteUrl = new URL(trimmed, window.location.href).href;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
      return { value: absoluteUrl, note: t('index.scenarioStorage.notes.convertedBackground') };
    }
    return { value: absoluteUrl };
  } catch (error) {
    return { error: t('index.scenarioStorage.errors.invalidBackgroundUrl') };
  }
}

function cloneScenario(scenario) {
  if (typeof structuredClone === 'function') {
    return structuredClone(scenario);
  }
  return JSON.parse(JSON.stringify(scenario));
}

function storeScenario(scenario, filename) {
  const entries = loadStoredScenarios();
  const entry = {
    id: createId(),
    title: scenario.meta.title,
    uploadedAt: new Date().toISOString(),
    filename,
    scenario
  };

  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.length = MAX_ENTRIES;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  const slotIndex = entries.findIndex((item) => item.id === entry.id);
  return { slotIndex, entries };
}

function updateStoredScenarioTitle(entryId, newTitle) {
  const entries = loadStoredScenarios();
  const index = entries.findIndex((item) => item.id === entryId);

  if (index === -1) {
    return null;
  }

  const entry = entries[index];
  const updatedEntry = {
    ...entry,
    title: newTitle,
    scenario: {
      ...(entry.scenario || {}),
      meta: {
        ...(entry.scenario?.meta || {}),
        title: newTitle
      }
    }
  };

  entries[index] = updatedEntry;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  return entries;
}

function loadStoredScenarios() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Failed to read stored scenarios', error);
    return [];
  }
}

function createId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `scenario-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getStoredScenario(entryId) {
  return loadStoredScenarios().find((item) => item.id === entryId) || null;
}

function removeScenario(entryId) {
  const entries = loadStoredScenarios().filter((item) => item.id !== entryId);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  return entries;
}

function formatUploadedAt(value) {
  if (!value) {
    return t('common.status.notProvided');
  }

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return t('common.status.notProvided');
    }
    return date.toLocaleString();
  } catch (error) {
    return t('common.status.notProvided');
  }
}

function promptForTitle(defaultTitle, message) {
  let promptDefault = typeof defaultTitle === 'string' ? defaultTitle : '';

  for (;;) {
    const response = window.prompt(message, promptDefault);
    if (response === null) {
      return null;
    }

    const trimmed = response.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }

    setFeedback(t('common.messages.titleCannotBeEmpty'), 'error');
    promptDefault = '';
  }
}
function resolveActiveLocale() {
  const fallback = I18N_CONFIG?.defaultLocale || null;
  return getCurrentLocale() || getLocaleFromQuery() || getStoredLocale() || fallback;
}

