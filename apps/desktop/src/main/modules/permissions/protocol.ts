/** 权限管线的领域类型；共享定义在 @chaptale/shared，此处补充 main 侧求值输入。 */
export type { PermissionAction, PermissionRule, PermissionScope, RiskLevel } from '@chaptale/shared';

import type { RiskLevel } from '@chaptale/shared';

/** 一次能力调用的求值输入；subject 是参数摘要（如 bash 的命令、write 的路径）。 */
export interface PermissionRequest {
  toolName: string;
  riskLevel: RiskLevel;
  subject?: string;
}
