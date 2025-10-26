const STORAGE_KEY = 'uploadedScenarios';
const MAX_ENTRIES = 3;

const uploadInput = document.getElementById('scenarioUpload');
const feedbackEl = document.getElementById('scenarioUploadFeedback');
const tableEl = document.getElementById('storedScenariosTable');
const tableBodyEl = document.getElementById('storedScenariosBody');
const emptyStateEl = document.getElementById('storedScenariosEmpty');

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

renderStoredScenarios();

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

  if (!storageAvailable) {
    tableEl.hidden = true;
    emptyStateEl.hidden = false;
    emptyStateEl.textContent = 'Local storage is not available. Uploaded scenarios cannot be stored.';
    return;
  }

  const entries = Array.isArray(entriesOverride) ? entriesOverride : loadStoredScenarios();
  tableBodyEl.innerHTML = '';

  if (!entries.length) {
    tableEl.hidden = true;
    emptyStateEl.hidden = false;
    emptyStateEl.textContent = 'No uploaded scenarios yet.';
    return;
  }

  tableEl.hidden = false;
  emptyStateEl.hidden = true;

  entries.forEach((entry, index) => {
    const row = document.createElement('tr');
    row.dataset.entryId = entry.id;

    row.appendChild(createCell(String(index + 1)));
    row.appendChild(createCell(entry.title || 'Untitled'));
    row.appendChild(createCell(entry.filename || '—'));
    row.appendChild(createCell(formatUploadedAt(entry.uploadedAt)));

    const actionsCell = document.createElement('td');
    actionsCell.className = 'stored-scenarios-actions';
    actionsCell.appendChild(createActionButton('Play', 'play'));
    actionsCell.appendChild(createActionButton('Clear', 'clear'));
    row.appendChild(actionsCell);

    tableBodyEl.appendChild(row);
  });
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

function createActionButton(label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn';
  button.dataset.action = action;
  button.textContent = label;
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
