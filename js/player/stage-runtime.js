import { normToPx } from '../core/engine.js';
import { qs } from '../core/utils.js';

let stageEl = null;
let backgroundImg = null;
let anchorLayerEl = null;
let lastScenario = null;
const anchorElements = new Map();
let resizeObserver = null;
let windowResizeBound = false;

function ensureStageElement(){
  if(stageEl && document.body.contains(stageEl)){
    return stageEl;
  }
  stageEl = qs('#playerStage');
  return stageEl;
}

function clearStage(){
  if(!stageEl) return;
  stageEl.innerHTML = '';
  anchorElements.clear();
  backgroundImg = null;
  anchorLayerEl = null;
}

function resolveBackgroundSrc(scenario){
  const background = scenario?.stage?.background;
  if(!background) return '';
  if(background.startsWith('data:') || background.startsWith('blob:')){
    return background;
  }
  if(/^(?:https?:)?\/\//.test(background)){
    return background;
  }
  if(background.startsWith('/')){
    return background;
  }
  const base = scenario?.__baseUrl;
  if(!base){
    return background;
  }
  const trimmedBase = base.replace(/\/+$/, '');
  const trimmedBg = background.replace(/^\/+/, '');
  return trimmedBase ? `${trimmedBase}/${trimmedBg}` : trimmedBg;
}

function ensureAnchorLayer(){
  if(anchorLayerEl) return anchorLayerEl;
  if(!stageEl) return null;
  anchorLayerEl = document.createElement('div');
  anchorLayerEl.className = 'anchor-layer';
  anchorLayerEl.style.position = 'absolute';
  anchorLayerEl.style.left = '0';
  anchorLayerEl.style.top = '0';
  anchorLayerEl.style.width = '100%';
  anchorLayerEl.style.height = '100%';
  anchorLayerEl.style.pointerEvents = 'none';
  anchorLayerEl.style.zIndex = '2';
  stageEl.appendChild(anchorLayerEl);
  return anchorLayerEl;
}

function createAnchorElement(anchor){
  const layer = ensureAnchorLayer();
  if(!layer) return null;
  const el = document.createElement('div');
  el.className = 'anchor-hit';
  el.dataset.anchorId = anchor.id;
  if(anchor.label){
    el.title = anchor.label;
    el.setAttribute('aria-label', anchor.label);
  } else if(anchor.id){
    el.setAttribute('aria-label', anchor.id);
  }
  el.tabIndex = 0;
  el.style.position = 'absolute';
  el.style.pointerEvents = 'auto';
  layer.appendChild(el);
  return el;
}

function clamp01(value){
  if(typeof value !== 'number' || Number.isNaN(value)){
    return 0;
  }
  if(value < 0) return 0;
  if(value > 1) return 1;
  return value;
}

function layoutAnchors(){
  const root = ensureStageElement();
  if(!root) return;
  const layer = ensureAnchorLayer();
  if(!layer) return;
  const width = root.clientWidth;
  const height = root.clientHeight;
  if(!width || !height) return;
  layer.style.width = `${width}px`;
  layer.style.height = `${height}px`;

  const anchors = Array.isArray(lastScenario?.anchors) ? lastScenario.anchors : [];
  for(const anchor of anchors){
    if(!anchor || !anchor.id) continue;
    const entry = anchorElements.get(anchor.id);
    if(!entry) continue;
    const { x, y } = normToPx(clamp01(anchor.x), clamp01(anchor.y), width, height);
    entry.x = x;
    entry.y = y;
    entry.element.style.left = `${x}px`;
    entry.element.style.top = `${y}px`;
  }
}

function rebuildAnchors(){
  const layer = ensureAnchorLayer();
  if(layer){
    layer.innerHTML = '';
  }
  anchorElements.clear();
  const anchors = Array.isArray(lastScenario?.anchors) ? lastScenario.anchors : [];
  for(const anchor of anchors){
    if(!anchor || !anchor.id) continue;
    if(typeof anchor.x !== 'number' || typeof anchor.y !== 'number') continue;
    const element = createAnchorElement(anchor);
    if(!element) continue;
    anchorElements.set(anchor.id, { element, anchor, x: 0, y: 0 });
  }
  layoutAnchors();
}

function onBackgroundReady(){
  layoutAnchors();
}

function bindResizeObservers(){
  if(typeof ResizeObserver === 'function'){
    if(resizeObserver){
      resizeObserver.disconnect();
    }
    const root = ensureStageElement();
    if(root){
      resizeObserver = new ResizeObserver(()=> layoutAnchors());
      resizeObserver.observe(root);
    }
  } else if(!windowResizeBound){
    window.addEventListener('resize', ()=> layoutAnchors());
    windowResizeBound = true;
  }
}

export function renderStage(scenario){
  lastScenario = scenario || null;
  const root = ensureStageElement();
  if(!root){
    return;
  }
  clearStage();
  const backgroundSrc = resolveBackgroundSrc(scenario);
  backgroundImg = document.createElement('img');
  backgroundImg.className = 'bg';
  backgroundImg.alt = 'Scenario Background';
  backgroundImg.style.display = 'block';
  backgroundImg.style.width = '100%';
  backgroundImg.style.height = 'auto';
  if(backgroundSrc){
    backgroundImg.src = backgroundSrc;
  }
  root.appendChild(backgroundImg);
  ensureAnchorLayer();
  rebuildAnchors();

  if(backgroundImg.complete){
    onBackgroundReady();
  } else {
    backgroundImg.addEventListener('load', onBackgroundReady, { once: true });
    backgroundImg.addEventListener('error', onBackgroundReady, { once: true });
  }
  requestAnimationFrame(()=> layoutAnchors());
  bindResizeObservers();
}

export function getAnchorAtPoint(inputX, inputY){
  const root = ensureStageElement();
  if(!root) return null;
  let clientX = inputX;
  let clientY = inputY;
  if(typeof inputX === 'object' && inputX !== null){
    const obj = inputX;
    if(typeof obj.clientX === 'number' && typeof obj.clientY === 'number'){
      clientX = obj.clientX;
      clientY = obj.clientY;
    } else if(typeof obj.x === 'number' && typeof obj.y === 'number'){
      clientX = obj.x;
      clientY = obj.y;
    }
  }
  if(typeof clientX !== 'number' || typeof clientY !== 'number'){
    return null;
  }
  const rect = root.getBoundingClientRect();
  const stageX = clientX - rect.left - root.clientLeft;
  const stageY = clientY - rect.top - root.clientTop;
  if(Number.isNaN(stageX) || Number.isNaN(stageY)){
    return null;
  }
  for(const [anchorId, entry] of anchorElements){
    const el = entry.element;
    if(!el) continue;
    const radius = (el.offsetWidth || el.clientWidth || 18) / 2;
    const dx = stageX - entry.x;
    const dy = stageY - entry.y;
    if((dx * dx) + (dy * dy) <= radius * radius){
      return { anchorId, element: el, x: entry.x, y: entry.y };
    }
  }
  return null;
}

export function getAnchorElement(anchorId){
  const entry = anchorElements.get(anchorId);
  return entry ? entry.element : null;
}
