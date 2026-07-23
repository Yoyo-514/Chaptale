import { IPC_CHANNELS, PermissionsDecideArgsValidator, PermissionsPendingArgsValidator } from '@chaptale/ipc-contract';
import type { PermissionAskEvent } from '@chaptale/ipc-contract';
import { BrowserWindow } from 'electron';

import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { PermissionBroker } from './broker';
import type { PermissionRuleStore } from './rule-store';

/**
 * 授权请求的推送与决策回传。
 *
 * ask 事件由主进程内的工具执行触发（没有发起方 sender），广播给所有存活窗口，
 * renderer 按 sessionId 过滤自己的授权卡片。
 */
export function registerPermissionsIpc(broker: PermissionBroker, ruleStore: PermissionRuleStore): void {
  handleValidatedIpc(IPC_CHANNELS.permissions.pending, PermissionsPendingArgsValidator, async (_event, sessionId) => {
    return broker.listPending(sessionId);
  });

  handleValidatedIpc(IPC_CHANNELS.permissions.decide, PermissionsDecideArgsValidator, async (_event, args) => {
    const pending = broker.listPending().find(entry => entry.requestId === args.requestId);

    if (!pending) {
      return { accepted: false };
    }

    // 规则先落库再放行：连续的同类工具调用能立即命中新规则，不再重复弹卡。
    if (args.decision.outcome === 'allow-always') {
      await ruleStore.addRule(
        { pattern: args.decision.pattern, action: 'allow' },
        args.decision.scope,
        pending.sessionId
      );
    }

    return { accepted: broker.decide(args.requestId, args.decision) !== null };
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
