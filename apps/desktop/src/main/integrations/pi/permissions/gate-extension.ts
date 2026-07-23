import type { InlineExtension, ToolCallEvent, ToolCallEventResult } from '@earendil-works/pi-coding-agent';

import type { RiskLevel } from '@chaptale/shared';

import type { PermissionBroker } from '../../../modules/permissions/broker';
import { evaluatePermission } from '../../../modules/permissions/engine';
import type { PermissionRequest } from '../../../modules/permissions/protocol';
import type { PermissionRuleStore } from '../../../modules/permissions/rule-store';

/** pi 内置工具的风险分级；bash 可执行任意命令，归入需确认档。 */
const BUILTIN_RISK_LEVELS: Record<string, RiskLevel> = {
  read: 'readonly',
  grep: 'readonly',
  find: 'readonly',
  ls: 'readonly',
  write: 'mutating',
  edit: 'mutating',
  bash: 'mutating'
};

interface PermissionGateOptions {
  sessionId: string;
  broker: PermissionBroker;
  ruleStore: PermissionRuleStore;
  /** 自定义工具的风险分级（按工具名）；未声明按 mutating 保守处理。 */
  customRiskLevels: Record<string, RiskLevel>;
  /**
   * 是否允许弹卡询问用户。task 会话无人值守，ask 一律按拒绝处理，
   * 避免自动化流程挂死等待授权。
   */
  interactive: boolean;
}

/**
 * 权限闸门：以 pi inline extension 挂在 tool_call 事件上，覆盖内置与自定义工具。
 * allow 放行、deny 以 block+reason 回给模型改道、ask 挂起等待用户决策。
 */
export function createPermissionGateExtension(options: PermissionGateOptions): InlineExtension {
  return {
    name: 'chaptale-permission-gate',
    hidden: true,
    factory: pi => {
      pi.on('tool_call', async (event): Promise<ToolCallEventResult | void> => {
        const request = toPermissionRequest(event, options.customRiskLevels);
        const action = evaluatePermission(request, await options.ruleStore.collect(options.sessionId));

        if (action === 'allow') {
          return;
        }

        if (action === 'deny' || !options.interactive) {
          return { block: true, reason: buildBlockReason(request, action, options.interactive) };
        }

        const decision = await options.broker.ask({ sessionId: options.sessionId, ...request });

        if (decision.outcome === 'deny') {
          return {
            block: true,
            reason: decision.reason ? `用户拒绝了此操作：${decision.reason}` : '用户拒绝了此操作'
          };
        }
      });
    }
  };
}

/** 提取求值输入：subject 取各工具最能代表其影响面的参数。 */
function toPermissionRequest(event: ToolCallEvent, customRiskLevels: Record<string, RiskLevel>): PermissionRequest {
  const input = event.input as Record<string, unknown>;
  const subjectValue = event.toolName === 'bash' ? input.command : input.path;

  return {
    toolName: event.toolName,
    riskLevel: BUILTIN_RISK_LEVELS[event.toolName] ?? customRiskLevels[event.toolName] ?? 'mutating',
    subject: typeof subjectValue === 'string' ? subjectValue : undefined
  };
}

function buildBlockReason(request: PermissionRequest, action: 'ask' | 'deny', interactive: boolean): string {
  if (action === 'deny') {
    return `权限策略拒绝了 ${request.toolName} 操作`;
  }

  return interactive
    ? `用户未授权 ${request.toolName} 操作`
    : `任务会话不支持交互授权，已拒绝 ${request.toolName} 操作`;
}
