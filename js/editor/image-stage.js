import { qs } from '../core/utils.js';

let stageEl = null;
let anchorLayer = null;
let anchorsPanel = null;
let bgInput = null;
let imgEl = null;
let stateRef = null;
let imageNaturalWidth = 0;
let imageNaturalHeight = 0;
let pendingFileName = null;
let activeDrag = null;
let suppressStageClick = false;
let persistDraftCallback = null;

function persistScenarioDraft(){
  if(typeof persistDraftCallback === 'function'){
    persistDraftCallback();
  }
}

function ensureElements(){
  if(stageEl) return;
  stageEl = qs('#stage');
  if(!stageEl) return;
  bgInput = qs('#bgUpload');

  imgEl = document.createElement('img');
  imgEl.className = 'stage-image';
  imgEl.alt = '';
  stageEl.appendChild(imgEl);

  anchorLayer = document.createElement('div');
  anchorLayer.className = 'anchor-layer';
  stageEl.appendChild(anchorLayer);

  anchorsPanel = qs('#anchorsPanel');
  if(anchorsPanel){
    anchorsPanel.addEventListener('change', onAnchorsPanelChange);
    anchorsPanel.addEventListener('click', onAnchorsPanelClick);
  }
}

function onAnchorsPanelChange(evt){
  const target = evt.target;
  if(!target || typeof target.closest !== 'function') return;
  const row = target.closest('.anchor-row');
  if(!row) return;
  const index = Number(row.dataset.index);
  if(Number.isNaN(index)) return;

  const anchors = stateRef?.scenario?.anchors;
  if(!anchors || !anchors[index]) return;
  const anchor = anchors[index];

  switch(target.name){
    case 'id': {
      const value = target.value.trim();
      if(!value){
        target.value = anchor.id;
        return;
      }
      const exists = anchors.some((a, i)=>i !== index && a.id === value);
      if(exists){
        target.value = anchor.id;
        return;
      }
      anchor.id = value;
      break;
    }
    case 'label': {
      anchor.label = target.value.trim();
      break;
    }
    case 'type': {
      anchor.type = target.value.trim();
      break;
    }
    case 'accepts': {
      const checkboxes = row.querySelectorAll('input[name="accepts"]');
      const list = Array.from(checkboxes)
        .filter(box => box.checked)
        .map(box => box.value);
      anchor.accepts = list;
      break;
    }
    default:
      return;
  }

  renderAnchors();
  renderAnchorsPanel();
  persistScenarioDraft();
}

function onAnchorsPanelClick(evt){
  const target = evt.target;
  if(!target || typeof target.closest !== 'function') return;
  const action = target.dataset ? target.dataset.action : null;
  if(action !== 'delete') return;
  const row = target.closest('.anchor-row');
  if(!row) return;
  const index = Number(row.dataset.index);
  if(Number.isNaN(index)) return;

  const anchors = stateRef?.scenario?.anchors;
  if(!anchors || !anchors[index]) return;

  anchors.splice(index, 1);
  renderAnchors();
  renderAnchorsPanel();
  persistScenarioDraft();
}

function handleFileChange(evt){
  const file = evt.target.files && evt.target.files[0];
  if(!file) return;
  pendingFileName = file.name;
  const reader = new FileReader();
  reader.addEventListener('load', e=>{
    const dataUrl = e.target.result;
    applyBackground(dataUrl, pendingFileName);
  });
  reader.readAsDataURL(file);
  evt.target.value = '';
}

function applyBackground(src, name=''){
  if(!imgEl) return;
  imgEl.src = src || '';
  if(stateRef){
    stateRef.scenario.stage.background = src || null;
    if(src){
      stateRef.scenario.stage.backgroundName = name || null;
    } else {
      stateRef.scenario.stage.backgroundName = null;
    }
  }
  persistScenarioDraft();
  if(!src){
    imageNaturalWidth = 0;
    imageNaturalHeight = 0;
    layoutStage();
  } else if(imgEl.complete){
    updateImageMetrics();
  }
  pendingFileName = null;
}

function updateImageMetrics(){
  imageNaturalWidth = imgEl ? imgEl.naturalWidth : 0;
  imageNaturalHeight = imgEl ? imgEl.naturalHeight : 0;
  if(stateRef && imageNaturalWidth && imageNaturalHeight){
    stateRef.scenario.stage.logicalWidth = imageNaturalWidth;
    stateRef.scenario.stage.logicalHeight = imageNaturalHeight;
    persistScenarioDraft();
  }
  layoutStage();
}

function computeImageLayout(){
  if(!stageEl || !imageNaturalWidth || !imageNaturalHeight){
    return { width:0, height:0, left:0, top:0, scale:0 };
  }
  const width = stageEl.clientWidth;
  const height = stageEl.clientHeight;
  if(!width || !height){
    return { width:0, height:0, left:0, top:0, scale:0 };
  }
  const scale = Math.min(width / imageNaturalWidth, height / imageNaturalHeight);
  const drawWidth = imageNaturalWidth * scale;
  const drawHeight = imageNaturalHeight * scale;
  const left = (width - drawWidth) / 2;
  const top = (height - drawHeight) / 2;
  return { width:drawWidth, height:drawHeight, left, top, scale };
}

function layoutStage(){
  if(!imgEl) return;
  const layout = computeImageLayout();
  if(!layout.scale){
    imgEl.style.display = 'none';
    if(anchorLayer){
      anchorLayer.style.display = 'none';
    }
    return;
  }
  imgEl.style.display = 'block';
  imgEl.style.width = `${layout.width}px`;
  imgEl.style.height = `${layout.height}px`;
  imgEl.style.left = `${layout.left}px`;
  imgEl.style.top = `${layout.top}px`;
  if(anchorLayer){
    anchorLayer.style.display = 'block';
  }
  renderAnchors();
}

function onStageClick(evt){
  if(suppressStageClick){
    suppressStageClick = false;
    return;
  }
  if(!imageNaturalWidth || !imageNaturalHeight || !stateRef) return;
  const layout = computeImageLayout();
  if(!layout.scale) return;

  const stageRect = stageEl.getBoundingClientRect();
  const clickX = evt.clientX - stageRect.left - layout.left;
  const clickY = evt.clientY - stageRect.top - layout.top;
  if(clickX < 0 || clickY < 0 || clickX > layout.width || clickY > layout.height){
    return;
  }
  const normX = Math.min(Math.max(clickX / layout.width, 0), 1);
  const normY = Math.min(Math.max(clickY / layout.height, 0), 1);
  addAnchor({ x: normX, y: normY });
}

function generateAnchorId(){
  const existing = stateRef?.scenario?.anchors || [];
  let counter = existing.length + 1;
  let id = `A${counter}`;
  const used = new Set(existing.map(a=>a.id));
  while(used.has(id)){
    counter += 1;
    id = `A${counter}`;
  }
  return id;
}

export function addAnchor(data){
  if(!stateRef) return null;
  const id = data?.id || generateAnchorId();
  const anchor = {
    id,
    label: data?.label || `Anchor ${id}`,
    type: data?.type || 'generic',
    x: clamp01(typeof data?.x === 'number' ? data.x : 0),
    y: clamp01(typeof data?.y === 'number' ? data.y : 0),
    accepts: Array.isArray(data?.accepts) ? [...data.accepts] : []
  };

  const anchors = stateRef.scenario.anchors;
  const index = anchors.findIndex(a=>a.id === anchor.id);
  if(index >= 0){
    anchors[index] = anchor;
  } else {
    anchors.push(anchor);
  }
  renderAnchors();
  renderAnchorsPanel();
  persistScenarioDraft();
  return anchor;
}

export function renderAnchors(){
  if(!anchorLayer || !stateRef) return;
  if(activeDrag) return;
  anchorLayer.innerHTML = '';
  const layout = computeImageLayout();
  if(!layout.scale) return;
  stateRef.scenario.anchors.forEach((anchor, index)=>{
    const x = clamp01(anchor.x);
    const y = clamp01(anchor.y);
    const dot = document.createElement('div');
    dot.className = 'anchor-dot';
    dot.style.left = `${layout.left + x * layout.width}px`;
    dot.style.top = `${layout.top + y * layout.height}px`;
    dot.dataset.index = String(index);
    dot.addEventListener('pointerdown', onAnchorPointerDown);

    const label = document.createElement('span');
    label.className = 'anchor-label';
    label.textContent = anchor.id;
    dot.appendChild(label);

    anchorLayer.appendChild(dot);
  });
}

function getAllowedDeviceOptions(){
  if(!stateRef || !stateRef.scenario) return [];
  const allowedIds = stateRef.scenario.devicePool?.allowedDeviceIds || [];
  if(!allowedIds.length) return [];
  const catalog = stateRef.catalog;
  const lookup = new Map();
  if(catalog?.categories){
    catalog.categories.forEach(cat=>{
      (cat.devices || []).forEach(device=>{
        lookup.set(device.id, { id: device.id, name: device.name || device.id });
      });
    });
  }
  return allowedIds.map(id => lookup.get(id) || { id, name: id });
}

function createLabeledTextInput(labelText, name, value){
  const label = document.createElement('label');
  label.className = 'anchor-field';
  const text = document.createElement('span');
  text.className = 'anchor-field__label';
  text.textContent = labelText;
  label.appendChild(text);

  const input = document.createElement('input');
  input.name = name;
  input.type = 'text';
  input.value = value;
  label.appendChild(input);

  return label;
}

export function renderAnchorsPanel(){
  if(!anchorsPanel || !stateRef) return;
  const anchors = stateRef.scenario?.anchors || [];
  anchorsPanel.innerHTML = '';

  if(!anchors.length){
    const empty = document.createElement('p');
    empty.textContent = 'No anchors yet. Click the stage to add one.';
    anchorsPanel.appendChild(empty);
    return;
  }

  const allowedOptions = getAllowedDeviceOptions();
  const allowedIdSet = new Set(allowedOptions.map(opt => opt.id));
  let updated = false;

  anchors.forEach((anchor, index)=>{
    let accepts = Array.isArray(anchor.accepts) ? [...anchor.accepts] : [];
    if(!Array.isArray(anchor.accepts)){
      updated = true;
    }
    if(allowedIdSet.size){
      const filtered = accepts.filter(id => allowedIdSet.has(id));
      if(filtered.length !== accepts.length){
        accepts = filtered;
        updated = true;
      } else {
        accepts = filtered;
      }
    } else if(accepts.length){
      accepts = [];
      updated = true;
    }

    anchor.accepts = accepts;
    const acceptsSet = new Set(accepts);

    const row = document.createElement('div');
    row.className = 'anchor-row';
    row.dataset.index = String(index);

    row.appendChild(createLabeledTextInput('ID', 'id', anchor.id || ''));
    row.appendChild(createLabeledTextInput('Label', 'label', anchor.label || ''));
    row.appendChild(createLabeledTextInput('Type', 'type', anchor.type || ''));

    const acceptsFieldset = document.createElement('fieldset');
    acceptsFieldset.className = 'anchor-accepts';

    const legend = document.createElement('legend');
    legend.textContent = 'Allowed Devices';
    acceptsFieldset.appendChild(legend);

    if(!allowedOptions.length){
      const emptyMessage = document.createElement('p');
      emptyMessage.className = 'anchor-accepts__empty';
      emptyMessage.textContent = 'Select allowed devices to configure anchor access.';
      acceptsFieldset.appendChild(emptyMessage);
    } else {
      allowedOptions.forEach(device => {
        const optionLabel = document.createElement('label');
        optionLabel.className = 'anchor-accepts__option';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'accepts';
        checkbox.value = device.id;
        checkbox.checked = acceptsSet.has(device.id);
        optionLabel.appendChild(checkbox);

        const optionName = document.createElement('span');
        optionName.textContent = device.name;
        optionLabel.appendChild(optionName);

        acceptsFieldset.appendChild(optionLabel);
      });
    }

    row.appendChild(acceptsFieldset);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-delete';
    deleteBtn.dataset.action = 'delete';
    deleteBtn.textContent = 'Delete';
    row.appendChild(deleteBtn);

    anchorsPanel.appendChild(row);
  });

  if(updated){
    persistScenarioDraft();
  }
}

export function initStage(state, callbacks = {}){
  stateRef = state;
  persistDraftCallback = typeof callbacks.persistScenarioDraft === 'function'
    ? callbacks.persistScenarioDraft
    : null;
  ensureElements();
  if(!stageEl) return;
  if(bgInput){
    bgInput.addEventListener('change', handleFileChange);
  }
  if(imgEl){
    imgEl.addEventListener('load', updateImageMetrics);
  }
  if(stageEl){
    stageEl.addEventListener('click', onStageClick);
  }
  window.addEventListener('resize', layoutStage);
  if(state?.scenario?.stage?.background){
    applyBackground(state.scenario.stage.background, state.scenario.stage.backgroundName || '');
  }
  else {
    layoutStage();
  }
  renderAnchors();
  renderAnchorsPanel();
}

export function teardownStage(){
  if(!stageEl) return;
  cancelActiveDrag();
  window.removeEventListener('resize', layoutStage);
  if(bgInput){
    bgInput.removeEventListener('change', handleFileChange);
  }
  if(imgEl){
    imgEl.removeEventListener('load', updateImageMetrics);
  }
  if(stageEl){
    stageEl.removeEventListener('click', onStageClick);
  }
  persistDraftCallback = null;
}

function clamp01(value){
  if(typeof value !== 'number' || Number.isNaN(value)) return 0;
  if(value < 0) return 0;
  if(value > 1) return 1;
  return value;
}

function onAnchorPointerDown(evt){
  if(!stateRef || !anchorLayer) return;
  const target = evt.currentTarget;
  if(!target || !target.dataset) return;
  const index = Number(target.dataset.index);
  if(Number.isNaN(index)) return;
  const anchors = stateRef.scenario?.anchors;
  if(!anchors || !anchors[index]) return;
  const layout = computeImageLayout();
  if(!layout.scale) return;

  suppressStageClick = true;
  evt.preventDefault();
  evt.stopPropagation();

  cancelActiveDrag();
  activeDrag = {
    index,
    pointerId: evt.pointerId,
    dot: target,
    moved: false
  };

  target.classList.add('dragging');
  if(target.setPointerCapture){
    target.setPointerCapture(evt.pointerId);
  }
  target.addEventListener('pointermove', onAnchorPointerMove);
  target.addEventListener('pointerup', onAnchorPointerUp);
  target.addEventListener('pointercancel', onAnchorPointerUp);
}

function onAnchorPointerMove(evt){
  if(!activeDrag || evt.pointerId !== activeDrag.pointerId) return;
  evt.preventDefault();
  const layout = computeImageLayout();
  if(!layout.scale) return;
  const anchors = stateRef?.scenario?.anchors;
  if(!anchors || !anchors[activeDrag.index]) return;

  const { x, y } = getNormalizedPointer(evt, layout);
  anchors[activeDrag.index].x = x;
  anchors[activeDrag.index].y = y;
  activeDrag.moved = true;

  const dot = activeDrag.dot;
  if(dot){
    dot.style.left = `${layout.left + x * layout.width}px`;
    dot.style.top = `${layout.top + y * layout.height}px`;
  }
  persistScenarioDraft();
}

function onAnchorPointerUp(evt){
  if(!activeDrag || evt.pointerId !== activeDrag.pointerId) return;
  evt.preventDefault();
  evt.stopPropagation();
  suppressStageClick = true;

  const { dot, pointerId, moved } = activeDrag;
  if(dot){
    dot.classList.remove('dragging');
    dot.removeEventListener('pointermove', onAnchorPointerMove);
    dot.removeEventListener('pointerup', onAnchorPointerUp);
    dot.removeEventListener('pointercancel', onAnchorPointerUp);
    if(dot.hasPointerCapture && dot.hasPointerCapture(pointerId)){
      dot.releasePointerCapture(pointerId);
    }
  }

  activeDrag = null;
  renderAnchors();
  if(moved){
    renderAnchorsPanel();
  }

  setTimeout(()=>{
    suppressStageClick = false;
  }, 0);
}

function cancelActiveDrag(){
  if(!activeDrag) return;
  const { dot, pointerId } = activeDrag;
  if(dot){
    dot.classList.remove('dragging');
    dot.removeEventListener('pointermove', onAnchorPointerMove);
    dot.removeEventListener('pointerup', onAnchorPointerUp);
    dot.removeEventListener('pointercancel', onAnchorPointerUp);
    if(dot.hasPointerCapture && dot.hasPointerCapture(pointerId)){
      dot.releasePointerCapture(pointerId);
    }
  }
  activeDrag = null;
  suppressStageClick = false;
}

function getNormalizedPointer(evt, layout){
  if(!stageEl || !layout.width || !layout.height){
    return { x:0, y:0 };
  }
  const rect = stageEl.getBoundingClientRect();
  const localX = evt.clientX - rect.left - layout.left;
  const localY = evt.clientY - rect.top - layout.top;
  const normX = clamp01(localX / layout.width);
  const normY = clamp01(localY / layout.height);
  return { x: normX, y: normY };
}
