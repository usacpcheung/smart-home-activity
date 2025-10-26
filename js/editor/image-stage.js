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

function escapeAttr(value){
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
      const list = target.value.split(',').map(token=>token.trim()).filter(Boolean);
      anchor.accepts = list;
      break;
    }
    case 'isDistractor': {
      anchor.isDistractor = Boolean(target.checked);
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
    accepts: Array.isArray(data?.accepts) ? [...data.accepts] : [],
    isDistractor: Boolean(data?.isDistractor)
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

  anchors.forEach((anchor, index)=>{
    const row = document.createElement('div');
    row.className = 'anchor-row';
    row.dataset.index = String(index);

    row.innerHTML = `
      <label>ID <input name="id" type="text" value="${escapeAttr(anchor.id)}"></label>
      <label>Label <input name="label" type="text" value="${escapeAttr(anchor.label || '')}"></label>
      <label>Type <input name="type" type="text" value="${escapeAttr(anchor.type || '')}"></label>
      <label>Accepts <input name="accepts" type="text" value="${escapeAttr((anchor.accepts||[]).join(', '))}"></label>
      <label class="check"><input name="isDistractor" type="checkbox" ${anchor.isDistractor ? 'checked' : ''}> Distractor</label>
      <button type="button" class="btn-delete" data-action="delete">Delete</button>
    `;

    anchorsPanel.appendChild(row);
  });
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
