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
    emptyStateEl.textContent = 'Loading sample scenario…';
  }

  renderStoredScenarios();

  if (sampleScenarioLoadPromise) {
    return;
  }

  sampleScenarioLoadPromise = loadSampleScenario()
    .catch((error) => {
      console.warn('Failed to load sample scenario', error);
      sampleScenarioEntry = null;
      setFeedback('Sample scenario could not be loaded. Upload a scenario JSON to get started.', 'error');
      if (emptyStateEl) {
        emptyStateEl.hidden = false;
        emptyStateEl.textContent = 'Sample scenario is unavailable. Upload a scenario JSON to continue.';
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
      throw new Error(errors.join(' ') || 'Sample scenario is invalid.');
    }

    sampleScenarioEntry = {
      id: SAMPLE_SCENARIO_ID,
      title: scenario.meta.title || 'Sample scenario',
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
    setFeedback('Local storage is not available. Uploaded scenarios will not be saved.', 'error');
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
    }
  });
}

initializeScenarioTable();

window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY) {
    renderStoredScenarios();
  }
});

if (uploadInput) {
  uploadInput.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    setFeedback('Reading scenario file…', 'info');

    try {
      const text = await readFileAsText(file);
      const rawScenario = JSON.parse(text);
      const { errors, scenario, notes } = validateAndNormalize(rawScenario);

      if (errors.length > 0) {
        setFeedback(`Upload failed: ${errors.join(' ')}`, 'error');
      } else if (!storageAvailable) {
        setFeedback('Local storage is not available. Scenario could not be saved.', 'error');
      } else {
        const { slotIndex, entries } = storeScenario(scenario, file.name);
        renderStoredScenarios(entries);
        const noteSuffix = notes.length > 0 ? ` ${notes.join(' ')}` : '';
        setFeedback(`Saved "${scenario.meta.title}" to slot ${slotIndex + 1}.` + noteSuffix, 'success');
      }
    } catch (error) {
      const reason = error instanceof SyntaxError
        ? 'Invalid JSON format.'
        : (error && typeof error.message === 'string' && error.message.length > 0
          ? error.message
          : 'Unexpected error.');
      setFeedback(`Upload failed: ${reason}`, 'error');
    } finally {
      // Reset so the same file can be uploaded again if needed.
      event.target.value = '';
    }
  });
}

function handlePlay(entryId) {
  if (entryId === SAMPLE_SCENARIO_ID) {
    if (!sampleScenarioEntry) {
      setFeedback('Sample scenario is not available. Please refresh and try again.', 'error');
      return;
    }

    window.location.href = `player.html?scenario=${encodeURIComponent(SAMPLE_SCENARIO_URL)}`;
    return;
  }

  if (!storageAvailable) {
    setFeedback('Local storage is not available. Unable to play stored scenarios.', 'error');
    return;
  }

  const entry = getStoredScenario(entryId);
  if (!entry) {
    setFeedback('Selected scenario is no longer available. Please upload it again.', 'error');
    renderStoredScenarios();
    return;
  }

  window.location.href = `player.html?storedSlot=${encodeURIComponent(entry.id)}`;
}

function handleClear(entryId) {
  if (entryId === SAMPLE_SCENARIO_ID) {
    setFeedback('Sample scenario cannot be cleared.', 'info');
    return;
  }

  if (!storageAvailable) {
    setFeedback('Local storage is not available. Nothing to clear.', 'error');
    return;
  }

  const entry = getStoredScenario(entryId);
  if (!entry) {
    setFeedback('Scenario slot is already empty.', 'info');
    renderStoredScenarios();
    return;
  }

  const entries = removeScenario(entryId);
  renderStoredScenarios(entries);
  const title = entry.title || 'Untitled scenario';
  setFeedback(`Cleared "${title}" from stored scenarios.`, 'info');
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
      emptyStateEl.textContent = 'Loading sample scenario…';
    } else {
      emptyStateEl.textContent = storageAvailable
        ? 'No uploaded scenarios yet.'
        : 'Local storage is not available. Uploaded scenarios cannot be stored.';
    }
    return;
  }

  tableEl.hidden = false;
  emptyStateEl.hidden = true;

  displayEntries.forEach((entry, index) => {
    const row = document.createElement('tr');
    row.dataset.entryId = entry.id;

    row.appendChild(createCell(String(index + 1)));
    row.appendChild(createCell(entry.title || 'Untitled'));
    row.appendChild(createCell(entry.filename || '—'));
    row.appendChild(createCell(formatUploadedAt(entry.uploadedAt)));

    const actionsCell = document.createElement('td');
    actionsCell.className = 'stored-scenarios-actions';
    actionsCell.appendChild(createActionButton('Play', 'play'));

    const clearButton = createActionButton('Clear', 'clear', entry.isSample ? {
      disabled: true,
      title: 'Sample scenario cannot be cleared.'
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
        reject(new Error('File content could not be read as text.'));
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
    errors.push('Scenario JSON must be an object.');
    return { errors, scenario: null, notes };
  }

  const scenario = cloneScenario(rawScenario);

  if (typeof scenario.meta !== 'object' || scenario.meta === null) {
    scenario.meta = {};
  }

  const title = scenario.meta.title;
  if (typeof title !== 'string' || title.trim().length === 0) {
    errors.push('Missing "meta.title" string.');
  } else {
    scenario.meta.title = title.trim();
  }

  if (typeof scenario.stage !== 'object' || scenario.stage === null) {
    scenario.stage = {};
  }

  const background = scenario.stage.background;
  if (typeof background !== 'string' || background.trim().length === 0) {
    errors.push('Missing "stage.background" string.');
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
    errors.push('Missing "devicePool" object.');
  } else if (!Array.isArray(scenario.devicePool.allowedDeviceIds)) {
    errors.push('"devicePool.allowedDeviceIds" must be an array.');
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
      return { value: absoluteUrl, note: 'Converted background path to an absolute URL.' };
    }
    return { value: absoluteUrl };
  } catch (error) {
    return { error: 'Invalid "stage.background" URL.' };
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
    return '—';
  }

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }
    return date.toLocaleString();
  } catch (error) {
    return '—';
  }
}
