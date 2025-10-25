// Shared runtime: coordinate transforms, placement model, evaluation hooks
export function normToPx(x, y, w, h) { return { x: x * w, y: y * h }; }

// Evaluation: check each aim using scenario.rules.checks
export function evaluate(scenario, placements, connected) {
  // placements: [{deviceId, anchorId}]
  const outcome = {};
  for (const chk of scenario.rules.checks) {
    const okDevices = chk.requiredPlacements.every(
      req => placements.some(p => p.deviceId === req.deviceId && p.anchorId === req.anchorId)
    );
    const okConn = chk.connectedRequired ? !!connected : true;
    outcome[chk.aimId] = okDevices && okConn;
  }
  return outcome;
}

// AI TODO: add simulation hooks (voice/lux) and call into animations by aimId.
