import { realpath, stat } from 'node:fs/promises';
import { unique } from 'radash';

import type { PermissionAskEvent, PermissionRuleEntry } from '@chaptale/ipc-contract';
import {
  IPC_CHANNELS,
  PermissionsDecideArgsValidator,
  PermissionsGrantExternalDirectoryArgsValidator,
  PermissionsListRulesArgsValidator,
  PermissionsPendingArgsValidator,
  PermissionsRemoveRuleArgsValidator
} from '@chaptale/ipc-contract';
import { EXTERNAL_ACCESS_CAPABILITIES, isExternalAccessCapability, type PermissionDecision } from '@chaptale/shared';

import type { IpcBroadcaster, IpcOwnerResolver, NativeDialogPort } from '../../core/ipc-ports';
import { assertLocalPath, isWithinAnyRoot, toRuleSubjectPath } from '../../infra/filesystem/path-guard';
import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { PermissionBroker } from './broker';
import type { PermissionRuleStore } from './rule-store';

interface PermissionsIpcOptions {
  /** 设置页按 UI 当前作品展示/删除持久规则；工具调用授权不得使用这个动态 cwd。 */
  resolveCwd: () => Promise<string | null> | string | null;
  /** 永不开放给 AI 的目录（Chaptale 配置目录）；授权作品外目录时拒绝落在其中。 */
  protectedRoots: readonly string[];
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
  ui: IpcBroadcaster & IpcOwnerResolver & Pick<NativeDialogPort, 'pickDirectory'>,
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
      assertPersistableDecision(pending.event.toolName, args.decision);
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

  // 目录由主进程弹系统选择器取得：renderer 只能表达读写级别，不能直接递交任意放行规则。
  handleValidatedIpc(
    IPC_CHANNELS.permissions.grantExternalDirectory,
    PermissionsGrantExternalDirectoryArgsValidator,
    async (event, args) => {
      const picked = await ui.pickDirectory(
        ui.resolveOwner(event),
        args.access === 'write' ? '选择 AI 可读写的作品外目录' : '选择 AI 可读取的作品外目录'
      );

      if (picked) {
        const directory = await resolveGrantDirectory(picked, options.protectedRoots);
        const capabilities =
          args.access === 'write'
            ? [EXTERNAL_ACCESS_CAPABILITIES.read, EXTERNAL_ACCESS_CAPABILITIES.write]
            : [EXTERNAL_ACCESS_CAPABILITIES.read];

        for (const capability of capabilities) {
          await ruleStore.addPersistentRule(
            { pattern: `${capability}(${directory}*)`, action: 'allow' },
            'global',
            null
          );
        }
      }

      return listRuleEntries(ruleStore, await options.resolveCwd());
    }
  );

  broker.onAsk((event: PermissionAskEvent) => {
    ui.broadcast(IPC_CHANNELS.permissions.ask, event);
  });
}

/**
 * 作品外能力的「始终允许」只能落会话或本机全局层，且必须限定到具体路径：
 * 作品层随作品流转（闸门对它只收拒绝），裸能力名或空前缀等于放行本机全部目录。
 * 规则还必须授给发起请求的同一能力——不能借一次普通授权夹带作品外放行。
 */
function assertPersistableDecision(
  toolName: string,
  decision: Extract<PermissionDecision, { outcome: 'allow-always' }>
): void {
  const ruleTool = /^[^(]*/.exec(decision.pattern)![0];

  if (!isExternalAccessCapability(toolName) && !isExternalAccessCapability(ruleTool)) {
    return;
  }

  if (ruleTool !== toolName) {
    throw new Error('授权规则与本次请求的操作不一致');
  }

  if (decision.scope === 'workspace') {
    throw new Error('作品外访问的授权不能保存为作品级规则');
  }

  const target = decision.pattern.endsWith(')') ? decision.pattern.slice(toolName.length + 1, -1) : '';

  if (!target.replace(/\*$/, '')) {
    throw new Error('作品外访问的授权必须限定到具体目录');
  }
}

/** 设置页选中的目录 → 规则前缀：取真实路径，必须是目录，不接受网络路径与受保护目录。 */
async function resolveGrantDirectory(picked: string, protectedRoots: readonly string[]): Promise<string> {
  assertLocalPath(picked);
  const real = await realpath(picked);

  if (!(await stat(real)).isDirectory()) {
    throw new Error(`选中的不是目录：${picked}`);
  }

  if (await isWithinAnyRoot(protectedRoots, real)) {
    throw new Error('Chaptale 配置目录不能开放给 AI');
  }

  return toRuleSubjectPath(real, { directory: true });
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
