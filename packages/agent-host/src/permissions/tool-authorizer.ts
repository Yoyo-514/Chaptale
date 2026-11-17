import { matchesMcpPermission, type McpCallTarget, mcpServerIdentity, type SessionMcpBridge } from '../mcp/index.ts';
import type {
  Approval,
  ApprovalScope,
  HostChange,
  McpApprovalRememberTarget,
  ToolPermission,
  ToolPermissionScope
} from '../protocol/index.ts';
import type { HostToolDecision, HostToolRequest } from '../tools/tool-access.ts';
import { type PendingApprovalEntry, ToolApprovals } from './approvals.ts';
import { inspectFsReadTarget, matchesFsReadPermission } from './fs-read.ts';
import type { ToolPermissionDraft } from './rules.ts';

/** 作者记住的放行规则；由本机设置保存。 */
export interface ToolPermissionStore {
  permissionsFor(sessionId: string, workId: string | null): ToolPermission[];
  /** 已有相同规则时返回 false。 */
  addToolPermission(draft: ToolPermissionDraft): Promise<boolean>;
}

export interface ToolAuthorizerOptions {
  rules: ToolPermissionStore;
  emit: (change: HostChange) => void;
  /** 规则写入后通知界面刷新设置。 */
  onRulesChanged: () => void;
  /** 作品是否还在作品库中；进了回收站的作品不能再保存作品级规则。 */
  workExists: (workId: string) => boolean;
}

/** 一次调用所在会话的授权条件。 */
export interface ToolCallScope {
  /** 会话归属的有效作品；未归属或作品已在回收站时为 null。 */
  workId: string | null;
  mcp: SessionMcpBridge;
  /** 目标是否落在已启用技能的目录内。 */
  allowsSkillTarget: (target: string) => boolean;
}

/**
 * 作品工具以外的调用授权：MCP 按服务逐台求值，原生只读文件工具按目标路径求值，其余一律询问作者。
 * 每次调用都读取当前规则，撤权立即生效。
 */
export class ToolAuthorizer {
  private readonly approvals: ToolApprovals;
  private readonly options: ToolAuthorizerOptions;

  constructor(options: ToolAuthorizerOptions) {
    this.options = options;
    this.approvals = new ToolApprovals(options.emit);
  }

  pending(): Approval[] {
    return this.approvals.list();
  }

  cancelAll(): void {
    this.approvals.cancelAll();
  }

  async authorize(
    request: HostToolRequest,
    scope: ToolCallScope,
    signal: AbortSignal | undefined
  ): Promise<HostToolDecision> {
    const { workId } = scope;
    const mcpDecision = await this.authorizeMcp(request, workId, scope.mcp, signal);
    if (mcpDecision) return mcpDecision;
    // 原生文件工具在工作目录与已启用技能目录内不逐次询问，目录外先匹配本机规则，未命中则由作者授权。
    const fsRead = await inspectFsReadTarget(request.toolName, request.input, request.cwd);
    if (fsRead) {
      if (fsRead.inCwd || (fsRead.target !== undefined && scope.allowsSkillTarget(fsRead.target)))
        return { allow: true };
      if (this.permitted({ sessionId: request.sessionId, workId, target: fsRead.target })) return { allow: true };
    }
    return this.approvals.enqueue(
      {
        ...request,
        workId,
        target: fsRead?.target,
        remember: fsRead?.remember && { ...fsRead.remember, allowWork: workId !== null }
      },
      signal
    );
  }

  /** 处理作者对一条授权请求的决定；选择记住时先保存规则，再放行其他已被这条规则覆盖的等待请求。 */
  async approve(input: {
    id: string;
    allow: boolean;
    scope?: ApprovalScope;
    mcpTarget?: McpApprovalRememberTarget;
  }): Promise<void> {
    const pending = this.approvals.peek(input.id);
    if (!pending) throw new Error('授权请求已结束，请查看当前状态');
    if (!input.allow) {
      this.approvals.finish(input.id, { allow: false });
      return;
    }
    const scope = input.scope ?? 'once';
    if (scope === 'once') {
      this.approvals.finish(input.id, { allow: true });
      return;
    }
    const remember = pending.value.remember;
    if (!remember) throw new Error('该调用仅支持单次允许');
    let ruleScope: ToolPermissionScope = { kind: 'session', sessionId: pending.value.sessionId };
    if (scope === 'work') {
      if (!remember.allowWork || !pending.workId || !this.options.workExists(pending.workId)) {
        throw new Error('当前会话不支持保存作品级授权');
      }
      ruleScope = { kind: 'work', workId: pending.workId };
    }
    const saved = await this.options.rules.addToolPermission(
      remember.capability === 'fs_read'
        ? { scope: ruleScope, capability: 'fs_read', path: remember.path, pathKind: remember.pathKind }
        : {
            scope: ruleScope,
            // SAFETY: MCP 的记住选项只由 authorizeMcp 生成，同时带有调用目标。
            ...mcpServerIdentity(pending.mcp!.server),
            ...(input.mcpTarget !== 'server' && { toolName: pending.mcp!.toolName })
          }
    );
    if (saved) this.options.onRulesChanged();
    const resolved = this.approvals.finish(input.id, { allow: true });
    this.approvals.allowMatching(entry => this.permitted({ ...entry, sessionId: entry.value.sessionId }));
    if (!resolved) throw new Error('授权请求已结束，请查看当前状态');
  }

  /** 本机会话／作品规则是否已放行这次调用。 */
  private permitted(entry: Pick<PendingApprovalEntry, 'workId' | 'target' | 'mcp'> & { sessionId: string }): boolean {
    const rules = this.options.rules.permissionsFor(entry.sessionId, entry.workId);
    const { mcp, target } = entry;
    if (mcp) return rules.some(rule => matchesMcpPermission(rule, mcp));
    return (
      target !== undefined && rules.some(rule => rule.capability === 'fs_read' && matchesFsReadPermission(rule, target))
    );
  }

  /**
   * MCP 调用按实际访问的服务逐台授权；不是 MCP 调用时返回 undefined。
   * 等待作者期间配置可能变化，每次批准后重新取目标；身份指纹变了的服务要重新询问。
   */
  private async authorizeMcp(
    request: HostToolRequest,
    workId: string | null,
    bridge: SessionMcpBridge,
    signal: AbortSignal | undefined
  ): Promise<HostToolDecision | undefined> {
    const once = new Set<string>();
    const key = ({ server, toolName }: McpCallTarget) => `${server.nodeKey}\0${server.fingerprint}\0${toolName}`;
    for (;;) {
      const targets = await bridge.targets(request.toolName, request.input);
      if (!targets) return undefined;
      const pending = targets.find(
        mcp => !once.has(key(mcp)) && !this.permitted({ sessionId: request.sessionId, workId, mcp })
      );
      if (!pending) return { allow: true };
      const decision = await this.approvals.enqueue(
        {
          ...request,
          workId,
          mcp: pending,
          remember: {
            capability: 'mcp',
            serverScope: pending.server.definedIn,
            serverName: pending.server.name,
            toolLabel: pending.toolName,
            allowWork: workId !== null
          }
        },
        signal
      );
      if (!decision.allow) return decision;
      once.add(key(pending));
    }
  }
}
