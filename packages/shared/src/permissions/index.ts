/** 权限管线的共享领域类型；main 求值与 renderer 授权卡片共用。 */

/** 求值结论：allow 直接放行、ask 需用户决策、deny 直接阻断。 */
export type PermissionAction = 'allow' | 'ask' | 'deny';

/**
 * 工具风险分级：无规则命中时按分级取默认动作，省掉低风险操作的无意义弹窗。
 *
 * sensitive：不改文件，但会把作品外的内容带进模型上下文——默认询问，无人值守任务一律拒绝。
 */
export type RiskLevel = 'readonly' | 'sensitive' | 'mutating' | 'destructive';

/**
 * 作品外访问能力：文件工具越出作品目录时改按能力名授权，一条目录规则覆盖同类全部工具。
 *
 * 作品级规则对它们只收拒绝、不收放行：作品目录随分享流转，不能夹带对本机其他目录的放行。
 */
export const EXTERNAL_ACCESS_CAPABILITIES = {
  read: 'external_read',
  write: 'external_write'
} as const;

export type ExternalAccessCapability = (typeof EXTERNAL_ACCESS_CAPABILITIES)[keyof typeof EXTERNAL_ACCESS_CAPABILITIES];

export function isExternalAccessCapability(name: string): name is ExternalAccessCapability {
  return name === EXTERNAL_ACCESS_CAPABILITIES.read || name === EXTERNAL_ACCESS_CAPABILITIES.write;
}

const EXTERNAL_DIRECTORY_RULE = /^(external_read|external_write)\((.+)\*\)$/;

/** 解析作品外目录规则（如 `external_read(E:/资料/*)`）；不是目录前缀形式时返回 null。 */
export function parseExternalDirectoryRule(
  pattern: string
): { capability: ExternalAccessCapability; directory: string } | null {
  const match = EXTERNAL_DIRECTORY_RULE.exec(pattern);

  return match ? { capability: match[1] as ExternalAccessCapability, directory: match[2]! } : null;
}

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
