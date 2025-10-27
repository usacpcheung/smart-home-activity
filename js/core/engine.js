import { MAX_RULE_GROUP_DEPTH } from './rules.js';

// Shared runtime: coordinate transforms, placement model, evaluation hooks
export function normToPx(x, y, w, h) { return { x: x * w, y: y * h }; }

// Evaluation: check each aim using scenario.rules.checks
export function evaluate(scenario, placements, connected) {
  // placements: [{deviceId, anchorId}]
  const outcome = {};
  const checks = scenario?.rules?.checks || [];
  for (const chk of checks) {
    const okDevices = evaluatePlacements(chk, placements);
    const okConn = chk.connectedRequired ? !!connected : true;
    outcome[chk.aimId] = okDevices && okConn;
  }
  return outcome;
}

function evaluatePlacements(check, placements) {
  const expression = check?.expression;
  if (Array.isArray(expression) && expression.length > 0) {
    return evaluateLegacyClauses(expression, placements);
  }

  if (expression && typeof expression === 'object') {
    return evaluateExpressionNode(expression, placements);
  }

  if (Array.isArray(check?.requiredPlacements) && check.requiredPlacements.length > 0) {
    return check.requiredPlacements.every(req =>
      placements.some(p => p.deviceId === req.deviceId && p.anchorId === req.anchorId)
    );
  }

  return true;
}

function evaluateExpressionNode(node, placements, depth = 0, path = 'root') {
  if (!node) return true;

  if (Array.isArray(node)) {
    return evaluateLegacyClauses(node, placements);
  }

  if (node.type === 'clause' || node.deviceId || node.anchorId) {
    if (!node.deviceId || !node.anchorId) {
      return false;
    }
    return placements.some(p => p.deviceId === node.deviceId && p.anchorId === node.anchorId);
  }

  if (node.type === 'group') {
    if (depth > MAX_RULE_GROUP_DEPTH) {
      console.warn(`Unsupported rules depth encountered at ${path} (depth ${depth}).`);
      return false;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      return true;
    }
    const op = node.operator === 'or' ? 'or' : 'and';
    if (op === 'or') {
      for (let idx = 0; idx < children.length; idx += 1) {
        const child = children[idx];
        const childPath = path === 'root' ? String(idx) : `${path}.${idx}`;
        if (evaluateExpressionNode(child, placements, depth + 1, childPath)) {
          return true;
        }
      }
      return false;
    }
    for (let idx = 0; idx < children.length; idx += 1) {
      const child = children[idx];
      const childPath = path === 'root' ? String(idx) : `${path}.${idx}`;
      if (!evaluateExpressionNode(child, placements, depth + 1, childPath)) {
        return false;
      }
    }
    return true;
  }

  return true;
}

function evaluateLegacyClauses(expression, placements) {
  if (!Array.isArray(expression) || expression.length === 0) {
    return true;
  }
  let result = null;
  for (let idx = 0; idx < expression.length; idx += 1) {
    const clause = expression[idx];
    if (!clause) continue;
    const match = placements.some(
      p => p.deviceId === clause.deviceId && p.anchorId === clause.anchorId
    );
    if (result === null) {
      result = match;
    } else {
      result = clause.operator === 'or' ? result || match : result && match;
    }
  }
  return result === null ? true : result;
}

// AI TODO: add simulation hooks (voice/lux) and call into animations by aimId.
