export const MAX_RULE_GROUP_DEPTH = 1;

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
      : 'Rules support only one level of subgroups. Move nested groups to the top level.'
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
    const label = issue.aimId ? `Aim "${issue.aimId}"` : `Check ${issue.index + 1}`;
    const paths = issue.violations.map(v => v.path).join(', ');
    return `${label} has unsupported nested groups (${paths || 'unknown location'}).`;
  }).join(' ');

  return {
    ok: false,
    issues,
    message: `${details} Rules currently support at most one level of subgroups.`
  };
}
