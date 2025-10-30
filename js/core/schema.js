// Scenario schema helpers: validate, upgrade versions if needed
export const CURRENT_SCHEMA = 1;

export function validateScenario(s) {
  const ok = s && s.stage && s.devicePool && Array.isArray(s.anchors) && Array.isArray(s.aims) && s.rules;
  if (!ok) {
    return false;
  }

  const checkClip = value => value == null || (typeof value === 'string' && /\.(mp3|wav)$/i.test(value.trim()));
  if (Object.prototype.hasOwnProperty.call(s, 'audio')) {
    const { audio } = s;
    if (!audio || typeof audio !== 'object') {
      return false;
    }

    if (Object.prototype.hasOwnProperty.call(audio, 'placement') && !checkClip(audio.placement)) {
      return false;
    }

    if (Object.prototype.hasOwnProperty.call(audio, 'aims')) {
      const { aims } = audio;
      if (!aims || typeof aims !== 'object') {
        return false;
      }
      if (Object.prototype.hasOwnProperty.call(aims, 'pass') && !checkClip(aims.pass)) {
        return false;
      }
      if (Object.prototype.hasOwnProperty.call(aims, 'fail') && !checkClip(aims.fail)) {
        return false;
      }
    }

    if (Object.prototype.hasOwnProperty.call(audio, 'rulesets')) {
      const { rulesets } = audio;
      if (!rulesets || typeof rulesets !== 'object') {
        return false;
      }
      if (Object.prototype.hasOwnProperty.call(rulesets, 'pass') && !checkClip(rulesets.pass)) {
        return false;
      }
      if (Object.prototype.hasOwnProperty.call(rulesets, 'fail') && !checkClip(rulesets.fail)) {
        return false;
      }
    }
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
