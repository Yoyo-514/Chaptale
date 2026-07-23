import type { PermissionDecision, PermissionRule, PermissionScope, RiskLevel } from '@chaptale/shared';

/** 设置页展示的规则及其所属层；持久规则列表不会返回 session 层。 */
export type PermissionRuleEntry = PermissionRule & {
  scope: Exclude<PermissionScope, 'session'>;
};

/** 删除指定持久层内所有完全相同的规则。 */
export type PermissionRemoveRuleArgs = PermissionRuleEntry;

/** 待授权请求：推送给 renderer 渲染授权卡片，也是 pending 查询的返回单元。 */
export type PermissionAskEvent = {
  requestId: string;
  sessionId: string;
  toolName: string;
  riskLevel: RiskLevel;
  /** 参数摘要（如 bash 的命令、write 的路径），用于展示与生成 allow-always 规则。 */
  subject?: string;
};

/** 决策提交参数。 */
export type PermissionDecideArgs = {
  requestId: string;
  decision: PermissionDecision;
};

/** 决策提交结果；accepted=false 表示请求已超时或已被处理，卡片应直接关闭。 */
export type PermissionDecideResult = {
  accepted: boolean;
};
