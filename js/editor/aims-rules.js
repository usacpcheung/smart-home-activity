import { qs } from '../core/utils.js';

let stateRef = null;
let persistDraft = null;
let aimsPanel = null;
let rulesPanel = null;
let listenersBound = false;

function persistScenarioDraft(){
  if(typeof persistDraft === 'function'){
    persistDraft();
  }
}

function ensurePanels(){
  if(!aimsPanel){
    aimsPanel = qs('#aimsPanel');
  }
  if(!rulesPanel){
    rulesPanel = qs('#rulesPanel');
  }
  if(!listenersBound){
    if(aimsPanel){
      aimsPanel.addEventListener('input', onAimsPanelInput);
      aimsPanel.addEventListener('change', onAimsPanelChange);
      aimsPanel.addEventListener('click', onAimsPanelClick);
    }
    if(rulesPanel){
      rulesPanel.addEventListener('change', onRulesPanelChange);
      rulesPanel.addEventListener('click', onRulesPanelClick);
    }
    listenersBound = true;
  }
}

export function initAimsRules(state, { persistScenarioDraft: persist } = {}){
  stateRef = state;
  persistDraft = persist || null;
  ensurePanels();
  renderAimsEditor();
  renderRulesEditor();
}

function getScenario(){
  return stateRef ? stateRef.scenario : null;
}

function ensureRulesStructure(){
  const scenario = getScenario();
  if(!scenario) return [];
  if(!scenario.rules){
    scenario.rules = { requireConnectButton: true, checks: [] };
  }
  const rules = scenario.rules;
  if(!Array.isArray(rules.checks)){
    rules.checks = [];
  }

  const aims = Array.isArray(scenario.aims) ? scenario.aims : [];
  const aimIds = new Set(aims.map(a => a.id));
  let changed = false;

  // Convert legacy requiredPlacements -> expression array
  for(const chk of rules.checks){
    if(!chk) continue;
    if(!Array.isArray(chk.expression)){
      if(Array.isArray(chk.requiredPlacements)){
        chk.expression = chk.requiredPlacements.map((req, idx) => ({
          operator: idx === 0 ? 'and' : 'and',
          deviceId: req?.deviceId || '',
          anchorId: req?.anchorId || ''
        }));
        changed = true;
      } else {
        chk.expression = [];
      }
    }
    if(Array.isArray(chk.expression)){
      chk.expression = chk.expression.map((clause, idx) => ({
        operator: (idx === 0 ? (clause?.operator || 'and') : (clause?.operator === 'or' ? 'or' : 'and')),
        deviceId: clause?.deviceId || '',
        anchorId: clause?.anchorId || ''
      }));
    }
    if ('requiredPlacements' in chk) {
      delete chk.requiredPlacements;
      changed = true;
    }
  }

  // Drop checks for missing aims
  const filtered = rules.checks.filter(chk => chk && aimIds.has(chk.aimId));
  if(filtered.length !== rules.checks.length){
    rules.checks = filtered;
    changed = true;
  }

  // Ensure a check exists for each aim
  for(const aim of aims){
    if(!rules.checks.some(chk => chk.aimId === aim.id)){
      rules.checks.push({ aimId: aim.id, connectedRequired: true, expression: [] });
      changed = true;
    }
  }

  if(changed){
    persistScenarioDraft();
  }

  return rules.checks;
}

function createAimRow(aim, index){
  const row = document.createElement('div');
  row.className = 'aim-row';
  row.dataset.index = String(index);

  const header = document.createElement('div');
  header.className = 'aim-row__fields';

  const idField = document.createElement('label');
  idField.className = 'aim-field';
  const idSpan = document.createElement('span');
  idSpan.className = 'aim-field__label';
  idSpan.textContent = 'Aim ID';
  const idInput = document.createElement('input');
  idInput.type = 'text';
  idInput.name = 'aim-id';
  idInput.value = aim.id || '';
  idInput.autocomplete = 'off';
  idField.appendChild(idSpan);
  idField.appendChild(idInput);

  const textField = document.createElement('label');
  textField.className = 'aim-field aim-field--wide';
  const textSpan = document.createElement('span');
  textSpan.className = 'aim-field__label';
  textSpan.textContent = 'Description';
  const textInput = document.createElement('textarea');
  textInput.name = 'aim-text';
  textInput.rows = 2;
  textInput.value = aim.text || '';
  textField.appendChild(textSpan);
  textField.appendChild(textInput);

  header.appendChild(idField);
  header.appendChild(textField);
  row.appendChild(header);

  const actions = document.createElement('div');
  actions.className = 'aim-row__actions';
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.dataset.action = 'delete-aim';
  removeBtn.textContent = 'Remove aim';
  actions.appendChild(removeBtn);
  row.appendChild(actions);

  return row;
}

export function renderAimsEditor(){
  ensurePanels();
  if(!aimsPanel) return;
  const scenario = getScenario();
  aimsPanel.innerHTML = '';
  if(!scenario){
    aimsPanel.textContent = 'No scenario loaded.';
    return;
  }
  const aims = Array.isArray(scenario.aims) ? scenario.aims : [];

  if(aims.length === 0){
    const empty = document.createElement('p');
    empty.className = 'aims-empty';
    empty.textContent = 'No aims yet. Add one to describe your learning goals.';
    aimsPanel.appendChild(empty);
  }

  aims.forEach((aim, index) => {
    aimsPanel.appendChild(createAimRow(aim, index));
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.dataset.action = 'add-aim';
  addBtn.className = 'aims-add';
  addBtn.textContent = 'Add aim';
  aimsPanel.appendChild(addBtn);
}

function createRuleRow(aimId, clause, index, options){
  const { deviceOptions, anchorOptions } = options;
  const row = document.createElement('div');
  row.className = 'rule-row';
  row.dataset.aimId = aimId;
  row.dataset.index = String(index);

  if(index > 0){
    const opField = document.createElement('label');
    opField.className = 'rule-field rule-field--operator';
    const opSpan = document.createElement('span');
    opSpan.className = 'rule-field__label';
    opSpan.textContent = 'Then';
    const opSelect = document.createElement('select');
    opSelect.name = 'operator';
    const andOption = document.createElement('option');
    andOption.value = 'and';
    andOption.textContent = 'AND';
    const orOption = document.createElement('option');
    orOption.value = 'or';
    orOption.textContent = 'OR';
    opSelect.appendChild(andOption);
    opSelect.appendChild(orOption);
    opSelect.value = clause.operator === 'or' ? 'or' : 'and';
    opField.appendChild(opSpan);
    opField.appendChild(opSelect);
    row.appendChild(opField);
  } else {
    const start = document.createElement('div');
    start.className = 'rule-start';
    start.textContent = 'Require placement:';
    row.appendChild(start);
  }

  const deviceField = document.createElement('label');
  deviceField.className = 'rule-field';
  const deviceLabel = document.createElement('span');
  deviceLabel.className = 'rule-field__label';
  deviceLabel.textContent = 'Device';
  const deviceSelect = document.createElement('select');
  deviceSelect.name = 'device';
  const emptyDevice = document.createElement('option');
  emptyDevice.value = '';
  emptyDevice.textContent = 'Select device';
  deviceSelect.appendChild(emptyDevice);
  deviceOptions.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    deviceSelect.appendChild(option);
  });
  deviceSelect.value = clause.deviceId || '';
  deviceField.appendChild(deviceLabel);
  deviceField.appendChild(deviceSelect);
  row.appendChild(deviceField);

  const anchorField = document.createElement('label');
  anchorField.className = 'rule-field';
  const anchorLabel = document.createElement('span');
  anchorLabel.className = 'rule-field__label';
  anchorLabel.textContent = 'Anchor';
  const anchorSelect = document.createElement('select');
  anchorSelect.name = 'anchor';
  const emptyAnchor = document.createElement('option');
  emptyAnchor.value = '';
  emptyAnchor.textContent = 'Select anchor';
  anchorSelect.appendChild(emptyAnchor);
  anchorOptions.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    anchorSelect.appendChild(option);
  });
  anchorSelect.value = clause.anchorId || '';
  anchorField.appendChild(anchorLabel);
  anchorField.appendChild(anchorSelect);
  row.appendChild(anchorField);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.dataset.action = 'delete-rule';
  removeBtn.textContent = 'Remove';
  row.appendChild(removeBtn);

  return row;
}

function renderAimRules(aim, check, options){
  const section = document.createElement('section');
  section.className = 'rules-section';
  section.dataset.aimId = aim.id;

  const header = document.createElement('header');
  header.className = 'rules-section__header';
  const title = document.createElement('h3');
  title.textContent = aim.text ? `${aim.text}` : aim.id;
  const subtitle = document.createElement('small');
  subtitle.textContent = `(${aim.id})`;
  header.appendChild(title);
  header.appendChild(subtitle);
  section.appendChild(header);

  const list = document.createElement('div');
  list.className = 'rules-section__list';

  const clauses = Array.isArray(check.expression) ? check.expression : [];
  if(clauses.length === 0){
    const empty = document.createElement('p');
    empty.className = 'rules-empty';
    empty.textContent = 'No placement rules yet.';
    list.appendChild(empty);
  } else {
    clauses.forEach((clause, idx) => {
      list.appendChild(createRuleRow(aim.id, clause, idx, options));
    });
  }
  section.appendChild(list);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.dataset.action = 'add-rule';
  addBtn.dataset.aimId = aim.id;
  addBtn.textContent = 'Add rule';
  section.appendChild(addBtn);

  return section;
}

export function renderRulesEditor(){
  ensurePanels();
  if(!rulesPanel) return;
  const scenario = getScenario();
  rulesPanel.innerHTML = '';
  if(!scenario){
    rulesPanel.textContent = 'No scenario loaded.';
    return;
  }

  const aims = Array.isArray(scenario.aims) ? scenario.aims : [];
  if(aims.length === 0){
    const empty = document.createElement('p');
    empty.className = 'rules-empty rules-empty--global';
    empty.textContent = 'Add aims before configuring rules.';
    rulesPanel.appendChild(empty);
    return;
  }

  const allDevices = [];
  const catalog = stateRef?.catalog;
  if (catalog && Array.isArray(catalog.categories)) {
    catalog.categories.forEach(cat => {
      (cat.devices || []).forEach(dev => {
        if (dev && dev.id) {
          allDevices.push({ value: dev.id, label: dev.name || dev.id });
        }
      });
    });
  }

  const allowedSet = new Set(scenario.devicePool?.allowedDeviceIds || []);
  const deviceList = allDevices.filter(opt => allowedSet.size === 0 || allowedSet.has(opt.value));
  const deviceOptions = deviceList.length > 0 ? deviceList : allDevices;

  const anchorOptions = (Array.isArray(scenario.anchors) ? scenario.anchors : []).map(anchor => ({
    value: anchor.id,
    label: anchor.label ? `${anchor.label} (${anchor.id})` : anchor.id
  }));

  const checks = ensureRulesStructure();

  aims.forEach(aim => {
    const check = checks.find(chk => chk.aimId === aim.id) || { expression: [] };
    rulesPanel.appendChild(renderAimRules(aim, check, { deviceOptions, anchorOptions }));
  });
}

function onAimsPanelInput(evt){
  const target = evt.target;
  if(!target || target.name !== 'aim-text') return;
  const row = target.closest('.aim-row');
  if(!row) return;
  const index = Number(row.dataset.index);
  const aims = stateRef?.scenario?.aims;
  if(!Array.isArray(aims) || !aims[index]) return;
  aims[index].text = target.value;
  persistScenarioDraft();
}

function onAimsPanelChange(evt){
  const target = evt.target;
  if(!target || target.name !== 'aim-id') return;
  const row = target.closest('.aim-row');
  if(!row) return;
  const index = Number(row.dataset.index);
  const aims = stateRef?.scenario?.aims;
  if(!Array.isArray(aims) || !aims[index]) return;
  const current = aims[index];
  const newId = (target.value || '').trim();
  if(!newId){
    target.value = current.id;
    return;
  }
  const duplicate = aims.some((aim, idx) => idx !== index && aim.id === newId);
  if(duplicate){
    target.value = current.id;
    return;
  }
  const oldId = current.id;
  current.id = newId;
  const checks = ensureRulesStructure();
  const entry = checks.find(chk => chk.aimId === oldId);
  if(entry){
    entry.aimId = newId;
  }
  persistScenarioDraft();
  renderAimsEditor();
  renderRulesEditor();
}

function onAimsPanelClick(evt){
  const target = evt.target;
  if(!target || !target.dataset) return;
  if(target.dataset.action === 'add-aim'){
    evt.preventDefault();
    addAim();
  } else if(target.dataset.action === 'delete-aim'){
    evt.preventDefault();
    const row = target.closest('.aim-row');
    if(!row) return;
    const index = Number(row.dataset.index);
    removeAim(index);
  }
}

function addAim(){
  const scenario = getScenario();
  if(!scenario) return;
  if(!Array.isArray(scenario.aims)){
    scenario.aims = [];
  }
  const aims = scenario.aims;
  let counter = aims.length + 1;
  let newId = `aim_${counter}`;
  const existingIds = new Set(aims.map(a => a.id));
  while(existingIds.has(newId)){
    counter += 1;
    newId = `aim_${counter}`;
  }
  aims.push({ id: newId, text: '' });
  ensureRulesStructure();
  persistScenarioDraft();
  renderAimsEditor();
  renderRulesEditor();
}

function removeAim(index){
  const scenario = getScenario();
  if(!scenario || !Array.isArray(scenario.aims)) return;
  if(index < 0 || index >= scenario.aims.length) return;
  const [removed] = scenario.aims.splice(index, 1);
  if(removed && scenario.rules && Array.isArray(scenario.rules.checks)){
    scenario.rules.checks = scenario.rules.checks.filter(chk => chk.aimId !== removed.id);
  }
  persistScenarioDraft();
  renderAimsEditor();
  renderRulesEditor();
}

function onRulesPanelChange(evt){
  const target = evt.target;
  if(!target) return;
  const row = target.closest('.rule-row');
  if(!row) return;
  const aimId = row.dataset.aimId;
  const index = Number(row.dataset.index);
  const checks = ensureRulesStructure();
  const entry = checks.find(chk => chk.aimId === aimId);
  if(!entry || !Array.isArray(entry.expression) || !entry.expression[index]) return;
  const clause = entry.expression[index];

  switch(target.name){
    case 'operator':
      clause.operator = target.value === 'or' ? 'or' : 'and';
      break;
    case 'device':
      clause.deviceId = target.value;
      break;
    case 'anchor':
      clause.anchorId = target.value;
      break;
    default:
      return;
  }
  persistScenarioDraft();
  renderRulesEditor();
}

function onRulesPanelClick(evt){
  const target = evt.target;
  if(!target || !target.dataset) return;
  if(target.dataset.action === 'add-rule'){
    evt.preventDefault();
    const aimId = target.dataset.aimId;
    addRuleForAim(aimId);
  } else if(target.dataset.action === 'delete-rule'){
    evt.preventDefault();
    const row = target.closest('.rule-row');
    if(!row) return;
    const aimId = row.dataset.aimId;
    const index = Number(row.dataset.index);
    removeRuleForAim(aimId, index);
  }
}

function addRuleForAim(aimId){
  const checks = ensureRulesStructure();
  const entry = checks.find(chk => chk.aimId === aimId);
  if(!entry){
    return;
  }
  if(!Array.isArray(entry.expression)){
    entry.expression = [];
  }
  const deviceId = '';
  const anchorId = '';
  entry.expression.push({
    operator: entry.expression.length === 0 ? 'and' : 'and',
    deviceId,
    anchorId
  });
  persistScenarioDraft();
  renderRulesEditor();
}

function removeRuleForAim(aimId, index){
  const checks = ensureRulesStructure();
  const entry = checks.find(chk => chk.aimId === aimId);
  if(!entry || !Array.isArray(entry.expression)) return;
  if(index < 0 || index >= entry.expression.length) return;
  entry.expression.splice(index, 1);
  persistScenarioDraft();
  renderRulesEditor();
}
