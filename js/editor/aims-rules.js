import { qs } from '../core/utils.js';
import { validateRulesStructure, MAX_RULE_GROUP_DEPTH } from '../core/rules.js';

let stateRef = null;
let persistDraft = null;
let aimsPanel = null;
let rulesPanel = null;
let listenersBound = false;

const ROOT_PATH = 'root';
const NOTICE_DEFAULT_DURATION = 4000;
const MESSAGE_VARIANTS = new Set(['info', 'warning', 'error', 'success']);

let rulesValidationState = { ok: true, message: '', issues: [] };
let rulesNotice = null;
let noticeTimeoutId = null;

function isRootPath(path){
  return !path || path === ROOT_PATH;
}

function updateRulesValidation(checks){
  rulesValidationState = validateRulesStructure(checks, { maxDepth: MAX_RULE_GROUP_DEPTH });
  return rulesValidationState;
}

function getRulesValidationState(){
  return rulesValidationState;
}

function setRulesNotice(message, variant = 'info', { duration = NOTICE_DEFAULT_DURATION } = {}){
  if(noticeTimeoutId){
    clearTimeout(noticeTimeoutId);
    noticeTimeoutId = null;
  }
  if(!message){
    rulesNotice = null;
    return;
  }
  rulesNotice = { message, variant };
  if(duration && duration > 0){
    noticeTimeoutId = setTimeout(() => {
      rulesNotice = null;
      noticeTimeoutId = null;
      renderRulesEditor();
    }, duration);
  }
}

function getRulesNotice(){
  return rulesNotice;
}

function createClauseNode(overrides = {}){
  return {
    type: 'clause',
    deviceId: overrides.deviceId || '',
    anchorId: overrides.anchorId || ''
  };
}

function createGroupNode(operator = 'and', children = []){
  return {
    type: 'group',
    operator: operator === 'or' ? 'or' : 'and',
    children: Array.isArray(children) ? children : []
  };
}

function normalizeClause(raw){
  if(raw && raw.type === 'clause'){
    return createClauseNode(raw);
  }
  return createClauseNode({
    deviceId: raw?.deviceId || '',
    anchorId: raw?.anchorId || ''
  });
}

function normalizeGroup(raw){
  const operator = raw?.operator === 'or' ? 'or' : 'and';
  const children = Array.isArray(raw?.children) ? raw.children : [];
  return createGroupNode(
    operator,
    children
      .map(child => {
        if(child?.type === 'group'){
          return normalizeGroup(child);
        }
        if(child?.type === 'clause' || child?.deviceId || child?.anchorId){
          return normalizeClause(child);
        }
        return null;
      })
      .filter(Boolean)
  );
}

function convertLegacyExpressionArray(clauses){
  if(!Array.isArray(clauses) || clauses.length === 0){
    return createGroupNode('and', []);
  }
  const normalized = clauses.map((clause, idx) => ({
    operator: clause?.operator === 'or' ? 'or' : 'and',
    deviceId: clause?.deviceId || '',
    anchorId: clause?.anchorId || '',
    idx
  }));

  function wrapNode(node){
    if(node?.type){
      return node;
    }
    return createClauseNode(node);
  }

  let tree = wrapNode(createClauseNode(normalized[0]));
  for(let i = 1; i < normalized.length; i += 1){
    const clause = normalized[i];
    const node = wrapNode(createClauseNode(clause));
    const op = clause.operator === 'or' ? 'or' : 'and';
    if(tree.type === 'group' && tree.operator === op){
      tree.children.push(node);
      continue;
    }
    tree = createGroupNode(op, [tree, node]);
  }

  if(tree.type !== 'group'){
    return createGroupNode('and', [tree]);
  }
  return tree;
}

function parsePath(path){
  if(!path || path === ROOT_PATH){
    return [];
  }
  return path
    .split('.')
    .map(segment => Number(segment))
    .filter(idx => Number.isInteger(idx));
}

function getParentPath(path){
  if(!path || path === ROOT_PATH){
    return null;
  }
  const indexes = parsePath(path);
  if(indexes.length === 0){
    return null;
  }
  indexes.pop();
  if(indexes.length === 0){
    return ROOT_PATH;
  }
  return indexes.join('.');
}

function getGroupAtPath(expression, path){
  if(!expression || expression.type !== 'group') return null;
  if(path === ROOT_PATH){
    return expression;
  }
  const indexes = parsePath(path);
  let node = expression;
  for(const idx of indexes){
    if(!node.children || !node.children[idx]){
      return null;
    }
    node = node.children[idx];
    if(!node || node.type !== 'group'){
      return null;
    }
  }
  return node;
}

function getParentGroup(expression, path){
  if(path === ROOT_PATH) return { parent: null, index: null };
  const indexes = parsePath(path);
  if(indexes.length === 0) return { parent: null, index: null };
  let parent = expression;
  for(let i = 0; i < indexes.length - 1; i += 1){
    const idx = indexes[i];
    if(!parent || parent.type !== 'group' || !Array.isArray(parent.children)){
      return { parent: null, index: null };
    }
    parent = parent.children[idx];
  }
  return { parent: parent && parent.type === 'group' ? parent : null, index: indexes[indexes.length - 1] };
}

function getNodeAtPath(expression, path){
  if(path === ROOT_PATH) return expression;
  const indexes = parsePath(path);
  let node = expression;
  for(const idx of indexes){
    if(!node || node.type !== 'group' || !Array.isArray(node.children)){
      return null;
    }
    node = node.children[idx];
  }
  return node || null;
}

function persistScenarioDraft(){
  if(typeof persistDraft === 'function' && rulesValidationState.ok){
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

  for(const chk of rules.checks){
    if(!chk) continue;

    if(Array.isArray(chk.requiredPlacements) && !chk.expression){
      chk.expression = chk.requiredPlacements.map(req => ({
        deviceId: req?.deviceId || '',
        anchorId: req?.anchorId || ''
      }));
      changed = true;
    }

    if(Array.isArray(chk.expression)){
      chk.expression = convertLegacyExpressionArray(chk.expression);
      changed = true;
    } else if(!chk.expression){
      chk.expression = createGroupNode('and', []);
    } else if(chk.expression?.type === 'group'){
      chk.expression = normalizeGroup(chk.expression);
    } else if(chk.expression?.type === 'clause'){
      chk.expression = createGroupNode('and', [normalizeClause(chk.expression)]);
      changed = true;
    }

    if(chk.expression?.type !== 'group'){
      chk.expression = createGroupNode('and', []);
      changed = true;
    }

    if('requiredPlacements' in chk){
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
      rules.checks.push({ aimId: aim.id, connectedRequired: true, expression: createGroupNode('and', []) });
      changed = true;
    }
  }

  const validation = updateRulesValidation(rules.checks);

  if(changed && validation.ok){
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

function createClauseRow(aimId, clause, path, options){
  const { deviceOptions, anchorOptions } = options;
  const row = document.createElement('div');
  row.className = 'rule-row rule-row--clause';
  row.dataset.aimId = aimId;
  row.dataset.path = path;

  const selection = document.createElement('label');
  selection.className = 'rule-field rule-field--select';
  const selectInput = document.createElement('input');
  selectInput.type = 'checkbox';
  selectInput.name = 'clause-select';
  selectInput.value = path;
  selection.appendChild(selectInput);
  const selectText = document.createElement('span');
  selectText.className = 'rule-field__label';
  selectText.textContent = 'Select';
  selection.appendChild(selectText);
  row.appendChild(selection);

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
  removeBtn.dataset.action = 'delete-clause';
  removeBtn.dataset.path = path;
  removeBtn.textContent = 'Remove';
  row.appendChild(removeBtn);

  return row;
}

function renderGroup(aimId, group, path, options){
  const section = document.createElement('div');
  section.className = 'rule-group' + (path === ROOT_PATH ? ' rule-group--root' : '');
  section.dataset.aimId = aimId;
  section.dataset.path = path;

  const header = document.createElement('div');
  header.className = 'rule-group__header';

  const openParen = document.createElement('span');
  openParen.className = 'rule-group__paren rule-group__paren--open';
  openParen.textContent = '(';
  header.appendChild(openParen);

  const operatorField = document.createElement('label');
  operatorField.className = 'rule-field rule-field--operator';
  const operatorLabel = document.createElement('span');
  operatorLabel.className = 'rule-field__label';
  operatorLabel.textContent = path === ROOT_PATH ? 'Require' : 'Group logic';
  const operatorSelect = document.createElement('select');
  operatorSelect.name = 'group-operator';
  const andOption = document.createElement('option');
  andOption.value = 'and';
  andOption.textContent = 'ALL (AND)';
  const orOption = document.createElement('option');
  orOption.value = 'or';
  orOption.textContent = 'ANY (OR)';
  operatorSelect.appendChild(andOption);
  operatorSelect.appendChild(orOption);
  operatorSelect.value = group.operator === 'or' ? 'or' : 'and';
  operatorField.appendChild(operatorLabel);
  operatorField.appendChild(operatorSelect);
  header.appendChild(operatorField);

  const closeParen = document.createElement('span');
  closeParen.className = 'rule-group__paren rule-group__paren--close';
  closeParen.textContent = ')';
  header.appendChild(closeParen);

  if(path !== ROOT_PATH){
    const removeGroupBtn = document.createElement('button');
    removeGroupBtn.type = 'button';
    removeGroupBtn.dataset.action = 'delete-group';
    removeGroupBtn.dataset.path = path;
    removeGroupBtn.textContent = 'Remove group';
    removeGroupBtn.disabled = group.children.length > 0;
    header.appendChild(removeGroupBtn);
  }

  section.appendChild(header);

  const childrenContainer = document.createElement('div');
  childrenContainer.className = 'rule-group__children';

  if(!Array.isArray(group.children) || group.children.length === 0){
    const empty = document.createElement('p');
    empty.className = 'rules-empty';
    empty.textContent = 'No clauses in this group yet.';
    childrenContainer.appendChild(empty);
  } else {
    group.children.forEach((child, idx) => {
      const childPath = path === ROOT_PATH ? String(idx) : `${path}.${idx}`;
      if(child?.type === 'group'){
        childrenContainer.appendChild(renderGroup(aimId, child, childPath, options));
      } else {
        childrenContainer.appendChild(createClauseRow(aimId, normalizeClause(child), childPath, options));
      }
    });
  }

  section.appendChild(childrenContainer);

  const controls = document.createElement('div');
  controls.className = 'rule-group__controls';

  const addClauseBtn = document.createElement('button');
  addClauseBtn.type = 'button';
  addClauseBtn.dataset.action = 'add-clause';
  addClauseBtn.dataset.path = path;
  addClauseBtn.textContent = 'Add clause';
  controls.appendChild(addClauseBtn);

  if(path === ROOT_PATH){
    const addGroupBtn = document.createElement('button');
    addGroupBtn.type = 'button';
    addGroupBtn.dataset.action = 'add-group';
    addGroupBtn.dataset.path = path;
    addGroupBtn.textContent = 'Add subgroup';
    controls.appendChild(addGroupBtn);

    const groupSelectedBtn = document.createElement('button');
    groupSelectedBtn.type = 'button';
    groupSelectedBtn.dataset.action = 'group-selected';
    groupSelectedBtn.dataset.path = path;
    groupSelectedBtn.textContent = 'Group selected';
    groupSelectedBtn.disabled = !Array.isArray(group.children) || group.children.length < 2;
    controls.appendChild(groupSelectedBtn);
  } else {
    const note = document.createElement('p');
    note.className = 'rules-note';
    note.textContent = 'Nested groups cannot contain additional subgroups. Use the top-level group to reorganize clauses.';
    controls.appendChild(note);
  }

  section.appendChild(controls);

  return section;
}

function createRulesMessageElement(message, variant = 'info'){
  const el = document.createElement('div');
  const normalized = typeof variant === 'string' ? variant.toLowerCase() : 'info';
  const safeVariant = MESSAGE_VARIANTS.has(normalized) ? normalized : 'info';
  el.className = `rules-message rules-message--${safeVariant}`;
  el.textContent = message;
  return el;
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

  const expression = check.expression?.type === 'group' ? check.expression : createGroupNode('and', []);
  list.appendChild(renderGroup(aim.id, expression, ROOT_PATH, options));

  section.appendChild(list);

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

  const checks = ensureRulesStructure();
  const notice = getRulesNotice();
  if(notice && notice.message){
    rulesPanel.appendChild(createRulesMessageElement(notice.message, notice.variant));
  }
  const validation = getRulesValidationState();
  if(!validation.ok && validation.message){
    rulesPanel.appendChild(createRulesMessageElement(validation.message, 'error'));
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

  aims.forEach(aim => {
    const check = checks.find(chk => chk.aimId === aim.id) || { expression: createGroupNode('and', []) };
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
  const checks = ensureRulesStructure();
  const entry = checks.find(chk => chk.aimId === oldId);
  current.id = newId;
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

function applyRuleMutation(aimId, mutator){
  if(!aimId) return;
  const checks = ensureRulesStructure();
  const entry = checks.find(chk => chk.aimId === aimId);
  if(!entry) return;
  const changed = mutator(entry, checks);
  if(changed){
    const validation = updateRulesValidation(checks);
    if(validation.ok){
      persistScenarioDraft();
    }
    renderRulesEditor();
  }
}

function addClauseToGroup(aimId, groupPath){
  applyRuleMutation(aimId, entry => {
    const group = getGroupAtPath(entry.expression, groupPath || ROOT_PATH);
    if(!group) return false;
    group.children.push(createClauseNode());
    return true;
  });
}

function addGroupToGroup(aimId, groupPath){
  const targetPath = groupPath || ROOT_PATH;
  if(!isRootPath(targetPath)){
    setRulesNotice('Subgroups can only be added to the main group.', 'warning');
    renderRulesEditor();
    return;
  }
  applyRuleMutation(aimId, entry => {
    const group = getGroupAtPath(entry.expression, targetPath);
    if(!group) return false;
    group.children.push(createGroupNode('and', []));
    return true;
  });
}

function removeClauseAtPath(aimId, clausePath){
  applyRuleMutation(aimId, entry => {
    const { parent, index } = getParentGroup(entry.expression, clausePath);
    if(!parent || typeof index !== 'number') return false;
    if(!Array.isArray(parent.children) || index < 0 || index >= parent.children.length) return false;
    parent.children.splice(index, 1);
    return true;
  });
}

function removeGroupAtPath(aimId, groupPath){
  if(!groupPath || groupPath === ROOT_PATH) return;
  applyRuleMutation(aimId, entry => {
    const { parent, index } = getParentGroup(entry.expression, groupPath);
    if(!parent || typeof index !== 'number') return false;
    const node = parent.children?.[index];
    if(!node || node.type !== 'group') return false;
    if(Array.isArray(node.children) && node.children.length > 0) return false;
    parent.children.splice(index, 1);
    return true;
  });
}

function wrapSelectedClauses(aimId, groupPath, clausePaths){
  const targetPath = groupPath || ROOT_PATH;
  if(!isRootPath(targetPath)){
    setRulesNotice('Grouping clauses is only supported at the top level.', 'warning');
    renderRulesEditor();
    return;
  }
  if(!Array.isArray(clausePaths) || clausePaths.length < 2) return;
  applyRuleMutation(aimId, entry => {
    const targetGroup = getGroupAtPath(entry.expression, targetPath);
    if(!targetGroup || !Array.isArray(targetGroup.children)) return false;
    const parentKey = targetPath && targetPath !== ROOT_PATH ? targetPath : ROOT_PATH;
    const indexes = [];
    for(const path of clausePaths){
      const parentPath = getParentPath(path);
      if((parentPath || ROOT_PATH) !== parentKey) return false;
      const parsed = parsePath(path);
      if(parsed.length === 0) return false;
      const idx = parsed[parsed.length - 1];
      if(!Number.isInteger(idx)) return false;
      if(indexes.includes(idx)) return false;
      const node = targetGroup.children[idx];
      if(!node || node.type !== 'clause') return false;
      indexes.push(idx);
    }
    indexes.sort((a, b) => a - b);
    const newGroup = createGroupNode('and', indexes.map(idx => targetGroup.children[idx]));
    for(let i = indexes.length - 1; i >= 0; i -= 1){
      targetGroup.children.splice(indexes[i], 1);
    }
    targetGroup.children.splice(indexes[0], 0, newGroup);
    return true;
  });
}

function onRulesPanelChange(evt){
  const target = evt.target;
  if(!target) return;

  if(target.name === 'device' || target.name === 'anchor'){
    const row = target.closest('.rule-row');
    if(!row) return;
    const aimId = row.dataset.aimId;
    const path = row.dataset.path;
    applyRuleMutation(aimId, entry => {
      const clause = getNodeAtPath(entry.expression, path);
      if(!clause || clause.type !== 'clause') return false;
      if(target.name === 'device'){
        if(clause.deviceId === target.value) return false;
        clause.deviceId = target.value;
        return true;
      }
      if(clause.anchorId === target.value) return false;
      clause.anchorId = target.value;
      return true;
    });
    return;
  }

  if(target.name === 'group-operator'){
    const group = target.closest('.rule-group');
    if(!group) return;
    const aimId = group.dataset.aimId;
    const path = group.dataset.path || ROOT_PATH;
    const newOperator = target.value === 'or' ? 'or' : 'and';
    applyRuleMutation(aimId, entry => {
      const node = getGroupAtPath(entry.expression, path);
      if(!node) return false;
      if(node.operator === newOperator) return false;
      node.operator = newOperator;
      return true;
    });
  }
}

function onRulesPanelClick(evt){
  const target = evt.target;
  if(!target || !target.dataset || !target.dataset.action) return;
  const action = target.dataset.action;
  switch(action){
    case 'add-clause': {
      evt.preventDefault();
      const groupEl = target.closest('.rule-group');
      if(!groupEl) return;
      addClauseToGroup(groupEl.dataset.aimId, target.dataset.path || groupEl.dataset.path);
      break;
    }
    case 'add-group': {
      evt.preventDefault();
      const groupEl = target.closest('.rule-group');
      if(!groupEl) return;
      addGroupToGroup(groupEl.dataset.aimId, target.dataset.path || groupEl.dataset.path);
      break;
    }
    case 'delete-clause': {
      evt.preventDefault();
      const row = target.closest('.rule-row');
      if(!row) return;
      removeClauseAtPath(row.dataset.aimId, target.dataset.path || row.dataset.path);
      break;
    }
    case 'delete-group': {
      evt.preventDefault();
      const groupEl = target.closest('.rule-group');
      if(!groupEl) return;
      removeGroupAtPath(groupEl.dataset.aimId, target.dataset.path || groupEl.dataset.path);
      break;
    }
    case 'group-selected': {
      evt.preventDefault();
      const groupEl = target.closest('.rule-group');
      if(!groupEl) return;
      const aimId = groupEl.dataset.aimId;
      const selected = Array.from(groupEl.querySelectorAll('input[name="clause-select"]:checked')).filter(cb => cb.closest('.rule-group') === groupEl);
      const paths = selected.map(cb => {
        const row = cb.closest('.rule-row');
        return row ? row.dataset.path : null;
      }).filter(Boolean);
      wrapSelectedClauses(aimId, target.dataset.path || groupEl.dataset.path, paths);
      break;
    }
    default:
      break;
  }
}
