// Scenario schema helpers: validate, upgrade versions if needed
export const CURRENT_SCHEMA = 1;

export function validateScenario(s) {
  const ok = s && s.stage && s.devicePool && Array.isArray(s.anchors) && Array.isArray(s.aims) && s.rules;
  if (!ok) {
    return false;
  }

  if (typeof s.rulesets === 'undefined' || s.rulesets === null) {
    return true;
  }

  if (!Array.isArray(s.rulesets)) {
    return false;
  }

  return s.rulesets.every(entry => {
    if (!entry || typeof entry !== 'object') return false;
    const hasId = typeof entry.id === 'string' && entry.id.trim().length > 0;
    const hasText = typeof entry.text === 'string' && entry.text.trim().length > 0;
    const correctValid = typeof entry.correct === 'boolean';
    return hasId && hasText && correctValid;
  });
}

// AI TODO: add richer validation with clear messages per field.
