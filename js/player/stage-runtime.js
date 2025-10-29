import { normToPx } from '../core/engine.js';
import { qs } from '../core/utils.js';

let stageEl = null;
let backgroundImg = null;
let anchorLayerEl = null;
let badgeOverlayEl = null;
let lastScenario = null;
const anchorElements = new Map();
let resizeObserver = null;
let windowResizeBound = false;
let lastStageMetrics = null;

const BADGE_OFFSETS_BY_COUNT = {
  1: [{ x: 0, y: -42 }],
  2: [{ x: -36, y: -34 }, { x: 36, y: -34 }],
  3: [{ x: -36, y: -34 }, { x: 36, y: -34 }, { x: -36, y: 36 }],
  4: [{ x: -36, y: -34 }, { x: 36, y: -34 }, { x: -36, y: 36 }, { x: 36, y: 36 }]
};

let anchorFeedbackEvaluator = null;
let removePlacementHandler = null;
let stageConnectionState = false;

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
  badgeOverlayEl = null;
  lastStageMetrics = null;
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

function ensureBadgeOverlay(){
  if(badgeOverlayEl) return badgeOverlayEl;
  if(!stageEl) return null;
  badgeOverlayEl = document.createElement('div');
  badgeOverlayEl.className = 'anchor-badge-layer';
  badgeOverlayEl.style.position = 'absolute';
  badgeOverlayEl.style.left = '0';
  badgeOverlayEl.style.top = '0';
  badgeOverlayEl.style.width = '100%';
  badgeOverlayEl.style.height = '100%';
  badgeOverlayEl.style.pointerEvents = 'none';
  badgeOverlayEl.style.zIndex = '4';
  stageEl.appendChild(badgeOverlayEl);
  return badgeOverlayEl;
}

function createAnchorElement(anchor){
  const layer = ensureAnchorLayer();
  const overlay = ensureBadgeOverlay();
  if(!layer) return null;

  const root = document.createElement('div');
  root.className = 'anchor-hit';
  root.dataset.anchorId = anchor.id;

  const labelText = typeof anchor.label === 'string' && anchor.label.trim()
    ? anchor.label.trim()
    : (anchor.id || '');

  if(labelText){
    root.setAttribute('aria-label', labelText);
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

  const placementContainer = document.createElement('div');
  placementContainer.className = 'anchor-hit__placements';
  if(overlay){
    overlay.appendChild(placementContainer);
  } else {
    root.appendChild(placementContainer);
  }

  layer.appendChild(root);
  return { root, hit: dot, label: labelEl, placements: placementContainer };
}

function applyBadgeConnectionState(badge){
  if(!badge) return;
  const connected = stageConnectionState === true;
  badge.classList.toggle('connected', connected);
  badge.classList.toggle('online', connected);
  badge.classList.toggle('disconnected', !connected);
  badge.classList.toggle('offline', !connected);
  badge.dataset.connectionState = connected ? 'connected' : 'disconnected';
}

function applyStageConnectionClass(){
  const root = ensureStageElement();
  if(!root) return;
  const connected = stageConnectionState === true;
  root.classList.toggle('stage--connected', connected);
  root.classList.toggle('stage--disconnected', !connected);
  root.dataset.connectionState = connected ? 'connected' : 'disconnected';
}

function refreshBadgeConnectionClasses(){
  for(const entry of anchorElements.values()){
    const container = entry?.placementContainer;
    if(!container) continue;
    for(const badge of container.children){
      applyBadgeConnectionState(badge);
    }
  }
}

function clamp01(value){
  if(typeof value !== 'number' || Number.isNaN(value)){
    return 0;
  }
  if(value < 0) return 0;
  if(value > 1) return 1;
  return value;
}

function computeBadgeOffsets(count){
  const capped = Math.max(0, Math.min(count, 4));
  const layout = BADGE_OFFSETS_BY_COUNT[capped] || [];
  return layout.slice(0, capped);
}

function deriveStageBounds(metrics){
  const data = metrics || {};
  const rect = data.rect;
  const width = rect?.width || data.width || 0;
  const height = rect?.height || data.height || 0;
  if(!width || !height){
    return null;
  }
  const padding = Number.isFinite(data.padding) ? data.padding : 0;
  return {
    minX: padding,
    minY: padding,
    maxX: width - padding,
    maxY: height - padding,
    width,
    height,
    padding
  };
}

function positionPlacementBadges(entry, stageMetrics = lastStageMetrics, options = {}){
  const container = entry?.placementContainer;
  if(!container) return null;
  const badges = Array.from(container.children);
  if(!badges.length){
    return null;
  }

  const { extraShift } = options;
  const applyStyles = options.applyStyles !== false;
  const extraShiftX = extraShift?.x ?? 0;
  const extraShiftY = extraShift?.y ?? 0;

  const offsets = computeBadgeOffsets(badges.length);
  const bounds = deriveStageBounds(stageMetrics);
  const anchorX = entry.relativeX ?? 0;
  const anchorY = entry.relativeY ?? 0;

  let clusterShiftX = 0;
  let clusterShiftY = 0;

  const badgeMetrics = badges.map((badge, index) => {
    const baseOffset = offsets[index] || offsets[offsets.length - 1] || { x: 0, y: 0 };
    const badgeRect = badge.getBoundingClientRect();
    const width = badgeRect?.width || badge.offsetWidth || badge.clientWidth || 64;
    const height = badgeRect?.height || badge.offsetHeight || badge.clientHeight || 64;
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const centerX = anchorX + baseOffset.x;
    const centerY = anchorY + baseOffset.y;
    return {
      badge,
      baseOffset,
      width,
      height,
      halfWidth,
      halfHeight,
      centerX,
      centerY
    };
  });

  if(bounds){
    let clusterMinX = Infinity;
    let clusterMaxX = -Infinity;
    let clusterMinY = Infinity;
    let clusterMaxY = -Infinity;

    for(const metric of badgeMetrics){
      const minX = metric.centerX - metric.halfWidth;
      const maxX = metric.centerX + metric.halfWidth;
      const minY = metric.centerY - metric.halfHeight;
      const maxY = metric.centerY + metric.halfHeight;
      if(minX < clusterMinX) clusterMinX = minX;
      if(maxX > clusterMaxX) clusterMaxX = maxX;
      if(minY < clusterMinY) clusterMinY = minY;
      if(maxY > clusterMaxY) clusterMaxY = maxY;
    }

    const clusterWidth = clusterMaxX - clusterMinX;
    const clusterHeight = clusterMaxY - clusterMinY;
    const stageWidthAvailable = bounds.maxX - bounds.minX;
    const stageHeightAvailable = bounds.maxY - bounds.minY;

    if(clusterWidth <= stageWidthAvailable){
      if(clusterMinX < bounds.minX){
        clusterShiftX = bounds.minX - clusterMinX;
      }
      if(clusterMaxX + clusterShiftX > bounds.maxX){
        clusterShiftX += bounds.maxX - (clusterMaxX + clusterShiftX);
      }
      if(clusterMinX + clusterShiftX < bounds.minX){
        clusterShiftX += bounds.minX - (clusterMinX + clusterShiftX);
      }
      if(clusterMaxX + clusterShiftX > bounds.maxX){
        clusterShiftX += bounds.maxX - (clusterMaxX + clusterShiftX);
      }
    } else {
      const clusterCenterX = (clusterMinX + clusterMaxX) / 2;
      const stageCenterX = (bounds.minX + bounds.maxX) / 2;
      clusterShiftX = stageCenterX - clusterCenterX;
    }

    if(clusterHeight <= stageHeightAvailable){
      if(clusterMinY < bounds.minY){
        clusterShiftY = bounds.minY - clusterMinY;
      }
      if(clusterMaxY + clusterShiftY > bounds.maxY){
        clusterShiftY += bounds.maxY - (clusterMaxY + clusterShiftY);
      }
      if(clusterMinY + clusterShiftY < bounds.minY){
        clusterShiftY += bounds.minY - (clusterMinY + clusterShiftY);
      }
      if(clusterMaxY + clusterShiftY > bounds.maxY){
        clusterShiftY += bounds.maxY - (clusterMaxY + clusterShiftY);
      }
    } else {
      const clusterCenterY = (clusterMinY + clusterMaxY) / 2;
      const stageCenterY = (bounds.minY + bounds.maxY) / 2;
      clusterShiftY = stageCenterY - clusterCenterY;
    }

    const finalShiftX = clusterShiftX + extraShiftX;
    const finalShiftY = clusterShiftY + extraShiftY;

    if(applyStyles){
      for(const metric of badgeMetrics){
        const offsetX = metric.baseOffset.x + finalShiftX;
        const offsetY = metric.baseOffset.y + finalShiftY;
        metric.badge.style.setProperty('--badge-offset-x', `${offsetX}px`);
        metric.badge.style.setProperty('--badge-offset-y', `${offsetY}px`);
      }
    }

    return {
      centerX: ((clusterMinX + clusterMaxX) / 2) + clusterShiftX,
      centerY: ((clusterMinY + clusterMaxY) / 2) + clusterShiftY,
      halfWidth: clusterWidth / 2,
      halfHeight: clusterHeight / 2,
      shiftX: clusterShiftX,
      shiftY: clusterShiftY,
      appliedShiftX: finalShiftX,
      appliedShiftY: finalShiftY,
      extraShiftX,
      extraShiftY
    };
  }

  if(applyStyles){
    for(const metric of badgeMetrics){
      const offsetX = metric.baseOffset.x + extraShiftX;
      const offsetY = metric.baseOffset.y + extraShiftY;
      metric.badge.style.setProperty('--badge-offset-x', `${offsetX}px`);
      metric.badge.style.setProperty('--badge-offset-y', `${offsetY}px`);
    }
  }

  return {
    centerX: anchorX,
    centerY: anchorY,
    halfWidth: 0,
    halfHeight: 0,
    shiftX: 0,
    shiftY: 0,
    appliedShiftX: extraShiftX,
    appliedShiftY: extraShiftY,
    extraShiftX,
    extraShiftY
  };
}

function clampClusterShift(baseCluster, shiftX, shiftY, bounds){
  if(!baseCluster || !bounds){
    return { x: shiftX, y: shiftY };
  }

  let nextX = shiftX;
  let nextY = shiftY;

  const ensureXWithinBounds = () => {
    if(baseCluster.halfWidth === 0){
      return;
    }
    const minX = baseCluster.centerX + nextX - baseCluster.halfWidth;
    const maxX = baseCluster.centerX + nextX + baseCluster.halfWidth;
    if(minX < bounds.minX){
      nextX += bounds.minX - minX;
    }
    if(maxX > bounds.maxX){
      nextX += bounds.maxX - maxX;
    }
  };

  const ensureYWithinBounds = () => {
    if(baseCluster.halfHeight === 0){
      return;
    }
    const minY = baseCluster.centerY + nextY - baseCluster.halfHeight;
    const maxY = baseCluster.centerY + nextY + baseCluster.halfHeight;
    if(minY < bounds.minY){
      nextY += bounds.minY - minY;
    }
    if(maxY > bounds.maxY){
      nextY += bounds.maxY - maxY;
    }
  };

  ensureXWithinBounds();
  ensureYWithinBounds();
  // Re-run clamps to handle cascading adjustments.
  ensureXWithinBounds();
  ensureYWithinBounds();

  return { x: nextX, y: nextY };
}

function getClusterBounds(entry){
  const baseCluster = entry?.badgeClusterBase;
  if(!baseCluster){
    return null;
  }
  const shift = entry.badgeCollisionShift || { x: 0, y: 0 };
  const minX = baseCluster.centerX + shift.x - baseCluster.halfWidth;
  const maxX = baseCluster.centerX + shift.x + baseCluster.halfWidth;
  const minY = baseCluster.centerY + shift.y - baseCluster.halfHeight;
  const maxY = baseCluster.centerY + shift.y + baseCluster.halfHeight;
  return { minX, maxX, minY, maxY };
}

function applyCollisionShift(entry, deltaX, deltaY, bounds){
  if(!entry?.badgeClusterBase){
    return false;
  }
  const current = entry.badgeCollisionShift || { x: 0, y: 0 };
  const next = clampClusterShift(entry.badgeClusterBase, current.x + (deltaX || 0), current.y + (deltaY || 0), bounds);
  if(next.x === current.x && next.y === current.y){
    return false;
  }
  entry.badgeCollisionShift = next;
  return true;
}

function resolveBadgeClusterCollisions(entries, stageMetrics = lastStageMetrics){
  if(!Array.isArray(entries) || entries.length < 2){
    return;
  }
  const bounds = deriveStageBounds(stageMetrics);
  if(!bounds){
    return;
  }

  const candidates = entries.filter((entry) => entry?.badgeClusterBase && entry.badgeClusterBase.halfWidth >= 0 && entry.badgeClusterBase.halfHeight >= 0);
  if(candidates.length < 2){
    return;
  }

  const maxIterations = candidates.length * candidates.length * 4;
  if(maxIterations <= 0){
    return;
  }

  const intersects = (a, b) => {
    if(!a || !b){
      return false;
    }
    return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
  };

  const attemptAxis = (axis, entryA, entryB, boundsA, boundsB) => {
    const overlapX = Math.min(boundsA.maxX, boundsB.maxX) - Math.max(boundsA.minX, boundsB.minX);
    const overlapY = Math.min(boundsA.maxY, boundsB.maxY) - Math.max(boundsA.minY, boundsB.minY);
    const overlap = axis === 'x' ? overlapX : overlapY;
    if(!(overlap > 0)){
      return false;
    }

    const baseA = entryA.badgeClusterBase;
    const baseB = entryB.badgeClusterBase;
    if(!baseA || !baseB){
      return false;
    }

    const direction = axis === 'x'
      ? (baseA.centerX >= baseB.centerX ? 1 : -1)
      : (baseA.centerY >= baseB.centerY ? 1 : -1);
    const pushAmount = (overlap / 2) + 1;
    const deltaAX = axis === 'x' ? direction * pushAmount : 0;
    const deltaAY = axis === 'y' ? direction * pushAmount : 0;
    const deltaBX = -deltaAX;
    const deltaBY = -deltaAY;

    const movedA = applyCollisionShift(entryA, deltaAX, deltaAY, bounds);
    const movedB = applyCollisionShift(entryB, deltaBX, deltaBY, bounds);
    return movedA || movedB;
  };

  let iteration = 0;
  while(iteration < maxIterations){
    let adjusted = false;
    for(let i = 0; i < candidates.length; i += 1){
      const entryA = candidates[i];
      let boundsA = getClusterBounds(entryA);
      if(!boundsA){
        continue;
      }
      for(let j = i + 1; j < candidates.length; j += 1){
        const entryB = candidates[j];
        let boundsB = getClusterBounds(entryB);
        if(!boundsB){
          continue;
        }
        if(!intersects(boundsA, boundsB)){
          continue;
        }

        const movedX = attemptAxis('x', entryA, entryB, boundsA, boundsB);
        if(movedX){
          adjusted = true;
          boundsA = getClusterBounds(entryA);
          boundsB = getClusterBounds(entryB);
          if(!intersects(boundsA, boundsB)){
            continue;
          }
        }

        const movedY = attemptAxis('y', entryA, entryB, boundsA, boundsB);
        if(movedY){
          adjusted = true;
          boundsA = getClusterBounds(entryA);
          boundsB = getClusterBounds(entryB);
        }
      }
    }
    if(!adjusted){
      break;
    }
    iteration += 1;
  }
}

function layoutAnchors(){
  const root = ensureStageElement();
  if(!root) return;
  const layer = ensureAnchorLayer();
  if(!layer) return;
  const overlay = ensureBadgeOverlay();
  if(!overlay) return;

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
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height}px`;
  overlay.style.left = `${offsetLeft}px`;
  overlay.style.top = `${offsetTop}px`;

  const anchors = Array.isArray(lastScenario?.anchors) ? lastScenario.anchors : [];
  const layerRect = layer.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  const rectSnapshot = overlayRect ? {
    width: overlayRect.width,
    height: overlayRect.height,
    left: overlayRect.left,
    top: overlayRect.top,
    right: overlayRect.right,
    bottom: overlayRect.bottom
  } : null;
  const stagePadding = 8;
  lastStageMetrics = {
    width: rectSnapshot?.width || width,
    height: rectSnapshot?.height || height,
    padding: stagePadding,
    rect: rectSnapshot
  };
  const collisionEntries = [];
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

    if(entry.placementContainer){
      entry.placementContainer.style.left = `${x}px`;
      entry.placementContainer.style.top = `${y}px`;
    }

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

    entry.badgeClusterBase = null;
    entry.badgeCluster = null;
    entry.badgeCollisionShift = { x: 0, y: 0 };

    const baseCluster = positionPlacementBadges(entry, lastStageMetrics, {
      extraShift: entry.badgeCollisionShift,
      applyStyles: false
    });
    if(baseCluster){
      entry.badgeClusterBase = baseCluster;
      collisionEntries.push(entry);
    }
  }

  if(collisionEntries.length){
    resolveBadgeClusterCollisions(collisionEntries, lastStageMetrics);
    for(const entry of collisionEntries){
      const finalCluster = positionPlacementBadges(entry, lastStageMetrics, {
        extraShift: entry.badgeCollisionShift,
        applyStyles: true
      });
      if(finalCluster){
        entry.badgeCluster = finalCluster;
      }
    }
  }
}

function clearAnchorFeedback(entry){
  if(!entry?.element) return;
  entry.element.classList.remove('anchor-hit--allowed', 'anchor-hit--blocked');
}

function applyAnchorFeedback(entry){
  if(!entry?.element || !entry.feedbackActive){
    clearAnchorFeedback(entry);
    return false;
  }
  if(typeof anchorFeedbackEvaluator !== 'function'){
    clearAnchorFeedback(entry);
    return false;
  }
  const evaluation = anchorFeedbackEvaluator(entry.anchor.id, entry);
  if(!evaluation){
    clearAnchorFeedback(entry);
    return false;
  }
  const allowed = !!evaluation.allowed;
  entry.element.classList.toggle('anchor-hit--allowed', allowed);
  entry.element.classList.toggle('anchor-hit--blocked', !allowed);
  return allowed;
}

function ensureAnchorFeedbackHandlers(anchorId){
  const entry = anchorElements.get(anchorId);
  if(!entry || entry.feedbackHandlers || !entry.element){
    return;
  }

  const handleDragEnter = (event) => {
    entry.feedbackActive = true;
    const allowed = applyAnchorFeedback(entry);
    if(allowed){
      event.preventDefault();
      if(event.dataTransfer){
        event.dataTransfer.dropEffect = 'copy';
      }
    }
  };

  const handleDragOver = (event) => {
    entry.feedbackActive = true;
    const allowed = applyAnchorFeedback(entry);
    if(allowed){
      event.preventDefault();
      if(event.dataTransfer){
        event.dataTransfer.dropEffect = 'copy';
      }
    }
  };

  const handleDragLeave = () => {
    entry.feedbackActive = false;
    clearAnchorFeedback(entry);
  };

  const handleDrop = () => {
    entry.feedbackActive = false;
    clearAnchorFeedback(entry);
  };

  const handleFocus = () => {
    entry.feedbackActive = true;
    applyAnchorFeedback(entry);
  };

  const handleBlur = () => {
    entry.feedbackActive = false;
    clearAnchorFeedback(entry);
  };

  entry.element.addEventListener('dragenter', handleDragEnter);
  entry.element.addEventListener('dragover', handleDragOver);
  entry.element.addEventListener('dragleave', handleDragLeave);
  entry.element.addEventListener('drop', handleDrop);
  entry.element.addEventListener('focus', handleFocus);
  entry.element.addEventListener('blur', handleBlur);

  entry.feedbackHandlers = {
    dragenter: handleDragEnter,
    dragover: handleDragOver,
    dragleave: handleDragLeave,
    drop: handleDrop,
    focus: handleFocus,
    blur: handleBlur
  };
}

function removeAnchorFeedbackHandlers(entry){
  if(!entry?.feedbackHandlers || !entry.element){
    return;
  }
  const handlers = entry.feedbackHandlers;
  entry.element.removeEventListener('dragenter', handlers.dragenter);
  entry.element.removeEventListener('dragover', handlers.dragover);
  entry.element.removeEventListener('dragleave', handlers.dragleave);
  entry.element.removeEventListener('drop', handlers.drop);
  entry.element.removeEventListener('focus', handlers.focus);
  entry.element.removeEventListener('blur', handlers.blur);
  entry.feedbackHandlers = null;
  entry.feedbackActive = false;
  clearAnchorFeedback(entry);
}

export function refreshAnchorFeedback(){
  for(const entry of anchorElements.values()){
    if(entry.feedbackActive){
      applyAnchorFeedback(entry);
    } else {
      clearAnchorFeedback(entry);
    }
  }
}

export function setAnchorFeedbackEvaluator(evaluator){
  anchorFeedbackEvaluator = typeof evaluator === 'function' ? evaluator : null;
  for(const [anchorId, entry] of anchorElements){
    if(anchorFeedbackEvaluator){
      ensureAnchorFeedbackHandlers(anchorId);
    } else {
      removeAnchorFeedbackHandlers(entry);
    }
  }
  refreshAnchorFeedback();
}

export function syncAnchorPlacements(placements, options = {}){
  removePlacementHandler = typeof options.onRemove === 'function' ? options.onRemove : null;

  const grouped = new Map();
  if(Array.isArray(placements)){
    for(const placement of placements){
      if(!placement || !placement.anchorId){
        continue;
      }
      if(!grouped.has(placement.anchorId)){
        grouped.set(placement.anchorId, []);
      }
      grouped.get(placement.anchorId).push(placement);
    }
  }

  for(const [anchorId, entry] of anchorElements){
    const container = entry.placementContainer;
    if(!container) continue;
    const anchorPlacements = (grouped.get(anchorId) || []).slice(0, 4);
    container.innerHTML = '';
    for(const placement of anchorPlacements){
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'anchor-hit__badge placed';
      badge.classList.add('anchor-hit__badge-card');
      badge.dataset.anchorId = anchorId;
      if(placement.deviceId){
        badge.dataset.deviceId = placement.deviceId;
      }
      const deviceLabel = placement.deviceName || placement.deviceId || 'Device';
      const anchorLabel = placement.anchorName || entry.anchor.label || entry.anchor.id || '';
      const accessibleLabel = anchorLabel
        ? `Remove ${deviceLabel} from ${anchorLabel}`
        : `Remove ${deviceLabel}`;
      badge.setAttribute('aria-label', accessibleLabel);
      badge.title = accessibleLabel;

      const fallbackLabel = placement.deviceFallbackLabel || (deviceLabel ? deviceLabel.trim().charAt(0).toUpperCase() : '');

      const renderFallback = () => {
        if(badge.querySelector('.anchor-hit__badge-fallback')){
          return;
        }
        const fallback = document.createElement('span');
        fallback.className = 'anchor-hit__badge-fallback';
        fallback.textContent = fallbackLabel || '?';
        badge.classList.add('anchor-hit__badge--fallback');
        badge.appendChild(fallback);
      };

      if(placement.deviceIconUrl){
        const icon = document.createElement('img');
        icon.className = 'anchor-hit__badge-icon';
        icon.src = placement.deviceIconUrl;
        icon.alt = '';
        icon.setAttribute('aria-hidden', 'true');
        icon.loading = 'lazy';
        icon.addEventListener('error', () => {
          icon.remove();
          renderFallback();
        }, { once: true });
        badge.appendChild(icon);
      } else {
        renderFallback();
      }

      const invokeRemove = () => {
        if(typeof removePlacementHandler === 'function'){
          removePlacementHandler({
            deviceId: placement.deviceId,
            anchorId,
            deviceName: placement.deviceName,
            anchorName: placement.anchorName
          });
        }
      };

      badge.addEventListener('click', invokeRemove);
      badge.addEventListener('keydown', (event) => {
        if(event.key === 'Enter' || event.key === ' '){
          event.preventDefault();
          invokeRemove();
        }
      });

      if(!badge.querySelector('.anchor-hit__badge-icon')){
        renderFallback();
      }

      applyBadgeConnectionState(badge);
      container.appendChild(badge);
    }
    positionPlacementBadges(entry, lastStageMetrics);
  }

  layoutAnchors();
}

export function setStageConnectionState(connected){
  stageConnectionState = connected === true;
  applyStageConnectionClass();
  refreshBadgeConnectionClasses();
}

export function getStageConnectionState(){
  return stageConnectionState === true;
}

function rebuildAnchors(){
  const layer = ensureAnchorLayer();
  if(layer){
    layer.innerHTML = '';
  }
  const overlay = ensureBadgeOverlay();
  if(overlay){
    overlay.innerHTML = '';
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
      placementContainer: element.placements || null,
      anchor,
      x: 0,
      y: 0,
      relativeX: 0,
      relativeY: 0,
      badgeClusterBase: null,
      badgeCluster: null,
      badgeCollisionShift: { x: 0, y: 0 },
      feedbackActive: false,
      feedbackHandlers: null
    });
    if(anchorFeedbackEvaluator){
      ensureAnchorFeedbackHandlers(anchor.id);
    }
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
  applyStageConnectionClass();
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
