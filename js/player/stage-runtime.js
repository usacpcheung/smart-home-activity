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

  const root = document.createElement('div');
  root.className = 'anchor-hit';
  root.dataset.anchorId = anchor.id;

  const labelText = typeof anchor.label === 'string' && anchor.label.trim()
    ? anchor.label.trim()
    : (anchor.id || '');

  if(labelText){
    root.setAttribute('aria-label', labelText);
    root.title = labelText;
  }

  root.tabIndex = 0;
  root.style.position = 'absolute';
  root.style.pointerEvents = 'auto';

  const dot = document.createElement('span');
  dot.className = 'anchor-hit__dot';
  dot.setAttribute('aria-hidden', 'true');
  root.appendChild(dot);

  let labelEl = null;
  if(labelText){
    labelEl = document.createElement('span');
    labelEl.className = 'anchor-hit__label';
    labelEl.textContent = labelText;
    labelEl.setAttribute('aria-hidden', 'true');
    root.appendChild(labelEl);
  }

  layer.appendChild(root);
  return { root, hit: dot, label: labelEl };
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

  let width = root.clientWidth;
  let height = root.clientHeight;
  let offsetLeft = 0;
  let offsetTop = 0;

  if(backgroundImg){
    const imgWidth = backgroundImg.offsetWidth || backgroundImg.clientWidth;
    const imgHeight = backgroundImg.offsetHeight || backgroundImg.clientHeight;
    if(imgWidth && imgHeight){
      width = imgWidth;
      height = imgHeight;
      offsetLeft = backgroundImg.offsetLeft;
      offsetTop = backgroundImg.offsetTop;
    }
  }

  if(!width || !height) return;

  layer.style.width = `${width}px`;
  layer.style.height = `${height}px`;
  layer.style.left = `${offsetLeft}px`;
  layer.style.top = `${offsetTop}px`;

  const anchors = Array.isArray(lastScenario?.anchors) ? lastScenario.anchors : [];
  const layerRect = layer.getBoundingClientRect();
  const stagePadding = 8;
  for(const anchor of anchors){
    if(!anchor || !anchor.id) continue;
    const entry = anchorElements.get(anchor.id);
    if(!entry) continue;
    const { x, y } = normToPx(clamp01(anchor.x), clamp01(anchor.y), width, height);
    entry.relativeX = x;
    entry.relativeY = y;
    entry.x = x + offsetLeft;
    entry.y = y + offsetTop;
    const anchorEl = entry.element;
    anchorEl.style.left = `${x}px`;
    anchorEl.style.top = `${y}px`;

    const labelEl = entry.labelElement;
    if(labelEl){
      anchorEl.classList.remove('anchor-hit--label-top');
      anchorEl.style.removeProperty('--anchor-label-shift-x');
      anchorEl.style.removeProperty('--anchor-label-shift-y');

      let labelRect = labelEl.getBoundingClientRect();
      if(labelRect.width || labelRect.height){
        if(labelRect.bottom > layerRect.bottom - stagePadding){
          anchorEl.classList.add('anchor-hit--label-top');
          labelRect = labelEl.getBoundingClientRect();
        }
        if(labelRect.top < layerRect.top + stagePadding){
          anchorEl.classList.remove('anchor-hit--label-top');
          labelRect = labelEl.getBoundingClientRect();
        }

        let shiftX = 0;
        if(labelRect.left < layerRect.left + stagePadding){
          shiftX = (layerRect.left + stagePadding) - labelRect.left;
        } else if(labelRect.right > layerRect.right - stagePadding){
          shiftX = (layerRect.right - stagePadding) - labelRect.right;
        }
        if(shiftX){
          anchorEl.style.setProperty('--anchor-label-shift-x', `${shiftX}px`);
          labelRect = labelEl.getBoundingClientRect();
        }

        let shiftY = 0;
        if(labelRect.top < layerRect.top + stagePadding){
          shiftY = (layerRect.top + stagePadding) - labelRect.top;
        } else if(labelRect.bottom > layerRect.bottom - stagePadding){
          shiftY = (layerRect.bottom - stagePadding) - labelRect.bottom;
        }
        if(shiftY){
          anchorEl.style.setProperty('--anchor-label-shift-y', `${shiftY}px`);
        }
      }
    }
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
    anchorElements.set(anchor.id, {
      element: element.root,
      hitElement: element.hit,
      labelElement: element.label || null,
      anchor,
      x: 0,
      y: 0,
      relativeX: 0,
      relativeY: 0
    });
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
    const hitEl = entry.hitElement || el;
    const radius = (hitEl.offsetWidth || hitEl.clientWidth || 18) / 2;
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
