/** 权限管线的共享领域类型；main 求值与 renderer 授权卡片共用。 */

/** 求值结论：allow 直接放行、ask 需用户决策、deny 直接阻断。 */
export type PermissionAction = 'allow' | 'ask' | 'deny';

/** 工具风险分级：无规则命中时按分级取默认动作，省掉低风险操作的无意义弹窗。 */
export type RiskLevel = 'readonly' | 'mutating' | 'destructive';

/**
 * 授权规则。pattern 两种形式：
 * - `toolName`：匹配该工具的全部调用；
 * - `toolName(prefix*)` / `toolName(exact)`：按 subject 前缀或精确匹配。
 */
export interface PermissionRule {
  pattern: string;
  action: PermissionAction;
}

/** 规则持久层级；"总是允许"默认落 workspace，global 需显式选择以防误操作。 */
export type PermissionScope = 'session' | 'workspace' | 'global';

/** 用户对一次 ask 的决策；allow-always 携带要落库的规则 pattern 与层级。 */
export type PermissionDecision =
  | { outcome: 'allow-once' }
  | { outcome: 'allow-always'; scope: PermissionScope; pattern: string }
  | { outcome: 'deny'; reason?: string };
