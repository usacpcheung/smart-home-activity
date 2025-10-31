import { t } from './i18n.js';

export const MAX_RULE_GROUP_DEPTH = 1;

function translateOrDefault(key, fallback, params){
  const translated = t(key, params);
  if(translated && translated !== key){
    return translated;
  }
  if(typeof fallback === 'function'){
    return fallback(params);
  }
  return fallback;
}

function walkGroup(node, depth, path, maxDepth, violations){
  if(!node || node.type !== 'group') return;
  if(depth > maxDepth){
    violations.push({ path, depth });
    return;
  }
  const children = Array.isArray(node.children) ? node.children : [];
  children.forEach((child, index) => {
    if(child && child.type === 'group'){
      const nextPath = path === 'root' ? String(index) : `${path}.${index}`;
      walkGroup(child, depth + 1, nextPath, maxDepth, violations);
    }
  });
}

export function validateRuleGroupDepth(group, maxDepth = MAX_RULE_GROUP_DEPTH){
  const violations = [];
  if(group && group.type === 'group'){
    walkGroup(group, 0, 'root', maxDepth, violations);
  }
  return {
    ok: violations.length === 0,
    violations,
    message: violations.length === 0
      ? ''
      : translateOrDefault(
          'editor.rules.validation.depthLimit',
          'Rules support only one level of subgroups. Move nested groups to the top level.'
        )
  };
}

export function validateRulesStructure(checks, { maxDepth = MAX_RULE_GROUP_DEPTH } = {}){
  const issues = [];
  (Array.isArray(checks) ? checks : []).forEach((chk, index) => {
    const result = validateRuleGroupDepth(chk?.expression, maxDepth);
    if(!result.ok){
      issues.push({
        aimId: chk?.aimId || null,
        index,
        violations: result.violations
      });
    }
  });

  if(issues.length === 0){
    return { ok: true, issues: [], message: '' };
  }

  const details = issues.map(issue => {
    const label = issue.aimId
      ? translateOrDefault('editor.rules.validation.aimLabel', `Aim "${issue.aimId}"`, { aimId: issue.aimId })
      : translateOrDefault('editor.rules.validation.checkLabel', `Check ${issue.index + 1}`, { index: issue.index + 1 });
    const paths = issue.violations.map(v => v.path).join(', ');
    const location = paths || translateOrDefault('editor.rules.validation.unknownLocation', 'unknown location');
    return translateOrDefault(
      'editor.rules.validation.issueDetail',
      `${label} has unsupported nested groups (${location}).`,
      { label, location }
    );
  }).join(' ');

  const message = translateOrDefault(
    'editor.rules.validation.summary',
    `${details} Rules currently support at most one level of subgroups.`,
    { details }
  );

  return {
    ok: false,
    issues,
    message
  };
}
