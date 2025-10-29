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
    if (!entry || typeof entry !== 'object') {
      return false;
    }

    if (Object.prototype.hasOwnProperty.call(entry, 'id') && entry.id != null) {
      if (typeof entry.id !== 'string') {
        return false;
      }
    }

    if (Object.prototype.hasOwnProperty.call(entry, 'text') && entry.text != null) {
      if (typeof entry.text !== 'string') {
        return false;
      }
    }

    if (Object.prototype.hasOwnProperty.call(entry, 'correct') && entry.correct != null) {
      const correctType = typeof entry.correct;
      if (correctType !== 'boolean' && correctType !== 'string' && correctType !== 'number') {
        return false;
      }
    }

    return true;
  });
}

// AI TODO: add richer validation with clear messages per field.
