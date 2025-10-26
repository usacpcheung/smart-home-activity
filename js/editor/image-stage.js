import { qs } from '../core/utils.js';

let stageEl = null;
let anchorLayer = null;
let bgInput = null;
let imgEl = null;
let stateRef = null;
let imageNaturalWidth = 0;
let imageNaturalHeight = 0;
let pendingFileName = null;

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
  return anchor;
}

export function renderAnchors(){
  if(!anchorLayer || !stateRef) return;
  anchorLayer.innerHTML = '';
  const layout = computeImageLayout();
  if(!layout.scale) return;
  stateRef.scenario.anchors.forEach(anchor=>{
    const x = clamp01(anchor.x);
    const y = clamp01(anchor.y);
    const dot = document.createElement('div');
    dot.className = 'anchor-dot';
    dot.style.left = `${layout.left + x * layout.width}px`;
    dot.style.top = `${layout.top + y * layout.height}px`;

    const label = document.createElement('span');
    label.className = 'anchor-label';
    label.textContent = anchor.id;
    dot.appendChild(label);

    anchorLayer.appendChild(dot);
  });
}

export function initStage(state){
  stateRef = state;
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
}

export function teardownStage(){
  if(!stageEl) return;
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
}

function clamp01(value){
  if(typeof value !== 'number' || Number.isNaN(value)) return 0;
  if(value < 0) return 0;
  if(value > 1) return 1;
  return value;
}
