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
  const expression = Array.isArray(check.expression) ? check.expression : null;
  if (expression && expression.length > 0) {
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

  if (Array.isArray(check.requiredPlacements) && check.requiredPlacements.length > 0) {
    return check.requiredPlacements.every(req =>
      placements.some(p => p.deviceId === req.deviceId && p.anchorId === req.anchorId)
    );
  }

  return true;
}

// AI TODO: add simulation hooks (voice/lux) and call into animations by aimId.
