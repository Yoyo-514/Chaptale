import type { PermissionAction, PermissionRequest, PermissionRule, RiskLevel } from './protocol';

/** 无规则命中时的分级默认：读类放行、写类询问、破坏类拒绝。 */
const DEFAULT_ACTION_BY_RISK: Record<RiskLevel, PermissionAction> = {
  readonly: 'allow',
  mutating: 'ask',
  destructive: 'deny'
};

/** 动作强度：多条规则命中时取最保守者，杜绝宽规则越权覆盖严规则。 */
const ACTION_SEVERITY: Record<PermissionAction, number> = {
  allow: 0,
  ask: 1,
  deny: 2
};

const PARAM_PATTERN = /^([A-Za-z0-9_-]+)\((.*)\)$/;

/** 规则匹配：无参数形式匹配工具全部调用；参数形式按 subject 前缀（尾 `*`）或精确比对。 */
export function ruleMatches(rule: PermissionRule, request: PermissionRequest): boolean {
  const parsed = PARAM_PATTERN.exec(rule.pattern);

  if (!parsed) {
    return rule.pattern === request.toolName;
  }

  if (parsed[1] !== request.toolName) {
    return false;
  }

  const argPattern = parsed[2];
  const subject = request.subject ?? '';
  return argPattern.endsWith('*') ? subject.startsWith(argPattern.slice(0, -1)) : subject === argPattern;
}

/**
 * 求值一次调用：命中规则中取最保守动作（deny > ask > allow）；
 * 无命中时按风险分级取默认。纯函数，规则来源层级由调用方合并后传入。
 */
export function evaluatePermission(request: PermissionRequest, rules: readonly PermissionRule[]): PermissionAction {
  let decision: PermissionAction | null = null;

  for (const rule of rules) {
    if (!ruleMatches(rule, request)) {
      continue;
    }

    if (decision === null || ACTION_SEVERITY[rule.action] > ACTION_SEVERITY[decision]) {
      decision = rule.action;
    }
  }

  return decision ?? DEFAULT_ACTION_BY_RISK[request.riskLevel];
}
