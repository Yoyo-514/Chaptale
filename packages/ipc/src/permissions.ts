import type { RiskLevel, PermissionDecision } from '@chaptale/shared';

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
