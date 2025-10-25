// Scenario schema helpers: validate, upgrade versions if needed
export const CURRENT_SCHEMA = 1;

export function validateScenario(s) {
  const ok = s && s.stage && s.devicePool && Array.isArray(s.anchors) && Array.isArray(s.aims) && s.rules;
  return !!ok;
}

// AI TODO: add richer validation with clear messages per field.
