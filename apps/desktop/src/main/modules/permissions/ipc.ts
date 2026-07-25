import { BrowserWindow } from 'electron';
import { unique } from 'radash';

import type { PermissionAskEvent, PermissionRuleEntry } from '@chaptale/ipc-contract';
import {
  IPC_CHANNELS,
  PermissionsDecideArgsValidator,
  PermissionsListRulesArgsValidator,
  PermissionsPendingArgsValidator,
  PermissionsRemoveRuleArgsValidator
} from '@chaptale/ipc-contract';

import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { PermissionBroker } from './broker';
import type { PermissionRuleStore } from './rule-store';

interface PermissionsIpcOptions {
  /** 设置页按 UI 当前工作区展示/删除持久规则；工具调用授权不得使用这个动态 cwd。 */
  resolveCwd: () => Promise<string | null> | string | null;
}

/**
 * 授权请求的推送与决策回传。
 *
 * ask 事件由主进程内的工具执行触发（没有发起方 sender），广播给所有存活窗口，
 * renderer 按 sessionId 过滤自己的授权卡片。
 */
export function registerPermissionsIpc(
  broker: PermissionBroker,
  ruleStore: PermissionRuleStore,
  options: PermissionsIpcOptions
): void {
  handleValidatedIpc(IPC_CHANNELS.permissions.pending, PermissionsPendingArgsValidator, async (_event, sessionId) => {
    return broker.listPending(sessionId);
  });

  handleValidatedIpc(IPC_CHANNELS.permissions.decide, PermissionsDecideArgsValidator, async (_event, args) => {
    const pending = broker.getPending(args.requestId);

    if (!pending) {
      return { accepted: false };
    }

    // 规则先落库再放行：连续的同类工具调用能立即命中新规则，不再重复弹卡。
    // allow-always 必须写入发起工具调用的会话 workspace，不能被设置页当前 cwd 劫持。
    if (args.decision.outcome === 'allow-always') {
      await ruleStore.addRule({ pattern: args.decision.pattern, action: 'allow' }, args.decision.scope, pending.ctx);
    }

    return { accepted: broker.decide(args.requestId, args.decision) !== null };
  });

  handleValidatedIpc(IPC_CHANNELS.permissions.listRules, PermissionsListRulesArgsValidator, async () => {
    return listRuleEntries(ruleStore, await options.resolveCwd());
  });

  handleValidatedIpc(IPC_CHANNELS.permissions.removeRule, PermissionsRemoveRuleArgsValidator, async (_event, args) => {
    const cwd = await options.resolveCwd();
    const { scope, ...rule } = args;
    await ruleStore.removePersistentRule(rule, scope, cwd);
    return listRuleEntries(ruleStore, cwd);
  });

  broker.onAsk((event: PermissionAskEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.webContents.isDestroyed()) {
        continue;
      }

      try {
        window.webContents.send(IPC_CHANNELS.permissions.ask, event);
      } catch {
        // isDestroyed 检查与 send 之间存在窗口销毁竞态；推送失败由超时兜底，不额外处理。
      }
    }
  });
}

async function listRuleEntries(ruleStore: PermissionRuleStore, cwd: string | null): Promise<PermissionRuleEntry[]> {
  const rules = await ruleStore.listPersistentRules(cwd);
  return [...uniqueRuleEntries(rules.workspace, 'workspace'), ...uniqueRuleEntries(rules.global, 'global')];
}

function uniqueRuleEntries(
  rules: Awaited<ReturnType<PermissionRuleStore['listPersistentRules']>>['workspace'],
  scope: PermissionRuleEntry['scope']
): PermissionRuleEntry[] {
  return unique(rules, rule => `${rule.action}\0${rule.pattern}`).map(rule => ({
    pattern: rule.pattern,
    action: rule.action,
    scope
  }));
}
