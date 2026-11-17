import {
  createMcpExtension,
  type ExtensionAPI,
  type ExtensionFactory,
  type McpServerConfig
} from '@earendil-works/pi-coding-agent';
import { McpConnectionClosedError, mcpNamespace, type McpTransport } from '@earendil-works/pi-mcp';
import { join } from 'node:path';

import type {
  ManagedMcpServerView,
  ManagedMcpSnapshot,
  McpConfigScope,
  McpSelectableExposure,
  McpToolPermission,
  ToolPermission
} from '../protocol/index.ts';
import {
  globalMcpConfigFile,
  loadMergedMcpConfig,
  type MergedMcpConfigResult,
  patchMcpServerInFile,
  type ResolvedMcpServerEntry,
  saveValidatedMcpConfig,
  workMcpConfigFile
} from './config.ts';
import { SharedMcpNode, usesOAuth } from './hub.ts';
import { HostMcpOAuthCoordinator } from './oauth-store.ts';

const RESOURCE_TOOL_NAMES = new Set(['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource']);
const MCP_TOOL_PREFIX = 'mcp__';

/** 会话可见的 MCP 工具名：服务工具前缀与三个跨服务资源工具。 */
export const sessionMcpToolNames = [`${MCP_TOOL_PREFIX}*`, ...RESOURCE_TOOL_NAMES];

export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX) || RESOURCE_TOOL_NAMES.has(name);
}

/** 一次工具调用实际访问的服务，以及授权规则使用的工具名。 */
export interface McpCallTarget {
  server: ResolvedMcpServerEntry;
  toolName: string;
}

/** 规则绑定的服务身份；命令或地址变化后指纹不同，旧规则不再命中。 */
export function mcpServerIdentity(
  server: ResolvedMcpServerEntry
): Pick<McpToolPermission, 'capability' | 'serverScope' | 'serverWorkId' | 'serverName' | 'serverFingerprint'> {
  return {
    capability: 'mcp',
    serverScope: server.definedIn,
    serverWorkId: server.definedWorkId,
    serverName: server.name,
    serverFingerprint: server.fingerprint
  };
}

/** 未指定工具名的规则放行该服务的全部调用。 */
export function matchesMcpPermission(rule: ToolPermission, target: McpCallTarget): boolean {
  const { server } = target;
  return (
    rule.capability === 'mcp' &&
    rule.serverScope === server.definedIn &&
    rule.serverWorkId === server.definedWorkId &&
    rule.serverName === server.name &&
    rule.serverFingerprint === server.fingerprint &&
    (rule.toolName === undefined || rule.toolName === target.toolName)
  );
}

export interface SessionMcpBridge {
  extensions: ExtensionFactory[];
  /**
   * 调用涉及的服务；不是 MCP 工具时返回 undefined，服务工具无法对应到已启用服务时抛错。
   * 未指定服务的资源工具会访问每台提供资源的服务，先等各共享连接建立或失败。
   */
  targets(toolName: string, input: unknown): Promise<McpCallTarget[] | undefined>;
  /** 调用所属的服务名与短工具名，供界面显示；资源工具未指定服务时只有工具名，认不出的调用返回 undefined。 */
  describeCall(toolName: string, input: unknown): { server?: string; tool: string } | undefined;
  dispose(): void;
}

interface BridgeRecord {
  workId: string | null;
  /** 按当前配置与共享连接代次重新登记服务；pi 只对内容有变化的服务断开重连。 */
  sync(): Promise<void>;
}

/**
 * 交给会话层的服务声明只含名称、说明与暴露方式。
 * 真实命令、env、headers 与凭据留在共享连接里；args 中的代次变化会让 pi 重新接入共享连接。
 */
function sessionProjection(entry: ResolvedMcpServerEntry, epoch: number): McpServerConfig {
  const { description, toolExposure, timeout } = entry.config;
  return {
    command: 'chaptale-shared-mcp',
    args: [entry.nodeKey, String(epoch)],
    exposure: entry.exposure,
    ...(description && { description }),
    ...(toolExposure && { toolExposure }),
    ...(timeout !== undefined && { timeout })
  };
}

/** 两级 mcp.json、进程级共享连接与 OAuth 登录的应用入口；每个服务身份只保留一条底层连接。 */
export class HostMcpService {
  private readonly agentDir: string;
  private readonly defaultGlobalCwd: string;
  private readonly resolveWorkFilesDir: (workId: string) => string | null | Promise<string | null>;
  private readonly onChange: () => void;
  private readonly oauth: HostMcpOAuthCoordinator;
  private readonly nodes = new Map<string, SharedMcpNode>();
  /** 共享连接被换新的次数；首次建立不计。 */
  private readonly epochs = new Map<string, number>();
  private readonly bridges = new Set<BridgeRecord>();

  constructor(options: {
    agentDir: string;
    /** 全局 stdio 服务未填 cwd 时使用的空目录。 */
    defaultGlobalCwd: string;
    resolveWorkFilesDir: (workId: string) => string | null | Promise<string | null>;
    onChange?: () => void;
  }) {
    this.agentDir = options.agentDir;
    this.defaultGlobalCwd = options.defaultGlobalCwd;
    this.resolveWorkFilesDir = options.resolveWorkFilesDir;
    this.onChange = options.onChange ?? (() => {});
    this.oauth = new HostMcpOAuthCoordinator({ agentDir: options.agentDir, onStateChange: this.onChange });
  }

  private async load(workId: string | null): Promise<MergedMcpConfigResult> {
    return loadMergedMcpConfig({
      agentDir: this.agentDir,
      workId,
      workFilesDir: workId ? await this.resolveWorkFilesDir(workId) : null,
      defaultGlobalCwd: this.defaultGlobalCwd
    });
  }

  private async configFile(scope: McpConfigScope, workId: string | null): Promise<string> {
    if (scope === 'global') return globalMcpConfigFile(this.agentDir);
    const dir = workId ? await this.resolveWorkFilesDir(workId) : null;
    if (!dir) throw new Error('目标作品不存在，无法读写作品级 MCP 配置');
    return workMcpConfigFile(dir);
  }

  private async find(workId: string | null, name: string): Promise<ResolvedMcpServerEntry> {
    const entry = (await this.load(workId)).servers.find(item => item.name === name);
    if (!entry) throw new Error(`未找到名为“${name}”的 MCP 服务`);
    return entry;
  }

  private ensureNode(entry: ResolvedMcpServerEntry): SharedMcpNode {
    let node = this.nodes.get(entry.nodeKey);
    if (!node) {
      node = new SharedMcpNode({
        entry,
        fallbackCwd: this.defaultGlobalCwd,
        oauth: this.oauth,
        onChange: this.onChange
      });
      this.nodes.set(entry.nodeKey, node);
      void node.ensureConnected().catch(() => {});
    }
    return node;
  }

  /** 关闭共享连接并中断在途调用；代次加一，会话下次同步时重新接入。 */
  private async dropNode(nodeKey: string): Promise<void> {
    const node = this.nodes.get(nodeKey);
    if (!node) return;
    this.nodes.delete(nodeKey);
    this.epochs.set(nodeKey, (this.epochs.get(nodeKey) ?? 0) + 1);
    this.oauth.cancelSignIn(nodeKey);
    await node.close();
  }

  private async syncBridges(workId?: string | null): Promise<void> {
    await Promise.all(
      [...this.bridges].filter(bridge => workId === undefined || bridge.workId === workId).map(bridge => bridge.sync())
    );
  }

  /** 换新连接并等它连上或失败，再让会话重新接入。 */
  private async renew(entry: ResolvedMcpServerEntry): Promise<void> {
    await this.dropNode(entry.nodeKey);
    if (entry.enabled)
      await this.ensureNode(entry)
        .ensureConnected()
        .catch(() => {});
    await this.syncBridges();
  }

  /** 配置变化后关闭本层级中已删除、已停用或连接参数变化的共享连接。作品级覆盖只影响该作品的会话。 */
  private async reconcile(scope: McpConfigScope, workId: string | null): Promise<void> {
    const merged = await this.load(scope === 'global' ? null : workId);
    const prefix = scope === 'global' ? 'global:' : `work:${workId}:`;
    const wanted = new Map(merged.servers.filter(item => item.enabled).map(item => [item.nodeKey, item.connectionKey]));
    await Promise.all(
      [...this.nodes]
        .filter(([key, node]) => key.startsWith(prefix) && wanted.get(key) !== node.connectionKey)
        .map(([key]) => this.dropNode(key))
    );
    await this.syncBridges(scope === 'global' ? undefined : workId);
    this.onChange();
  }

  /** 读取配置文本、校验错误与连接状态；已启用的服务在此建立共享连接，没有打开的会话也能看到工具。 */
  async getSnapshot(workId: string | null): Promise<ManagedMcpSnapshot> {
    const merged = await this.load(workId);
    const servers = await Promise.all(
      merged.servers.map(async (entry): Promise<ManagedMcpServerView> => {
        const { config } = entry;
        const oauth = usesOAuth(config);
        const node = entry.enabled ? this.ensureNode(entry) : undefined;
        const signingIn = this.oauth.getPendingSignIn(entry.nodeKey);
        return {
          name: entry.name,
          definedIn: entry.definedIn,
          ...(entry.overriddenInWork && { overriddenInWork: true }),
          transport: 'command' in config ? 'stdio' : 'http',
          endpoint: 'command' in config ? [config.command, ...(config.args ?? [])].join(' ') : config.url,
          ...(config.description && { description: config.description }),
          enabled: entry.enabled,
          exposure: entry.exposure,
          state: node?.state ?? 'disabled',
          ...(node?.error && { error: node.error }),
          tools: node?.tools ?? [],
          hasResources: node?.hasResources ?? false,
          usesOAuth: oauth,
          hasStoredAuth: oauth && 'url' in config && (await this.oauth.hasStoredTokens(entry.nodeKey, config.url)),
          ...(signingIn && { signingIn })
        };
      })
    );
    return {
      globalFile: merged.globalFile,
      globalJson: merged.globalJson,
      globalErrors: merged.globalErrors,
      workId,
      workFile: merged.workFile,
      workJson: merged.workJson,
      workErrors: merged.workErrors,
      servers
    };
  }

  async saveConfig(input: { scope: McpConfigScope; workId: string | null; json: string }): Promise<ManagedMcpSnapshot> {
    await saveValidatedMcpConfig(await this.configFile(input.scope, input.workId), input.scope, input.json);
    await this.reconcile(input.scope, input.workId);
    return this.getSnapshot(input.workId);
  }

  async patchServer(input: {
    targetScope: McpConfigScope;
    workId: string | null;
    name: string;
    enabled?: boolean;
    exposure?: McpSelectableExposure;
  }): Promise<ManagedMcpSnapshot> {
    const { targetScope, workId, name, enabled, exposure } = input;
    await patchMcpServerInFile(await this.configFile(targetScope, workId), targetScope, name, { enabled, exposure });
    await this.reconcile(targetScope, workId);
    return this.getSnapshot(workId);
  }

  async reconnectServer(input: { workId: string | null; name: string }): Promise<ManagedMcpSnapshot> {
    const entry = await this.find(input.workId, input.name);
    if (!entry.enabled) throw new Error(`MCP 服务“${input.name}”已停用，请先启用`);
    await this.renew(entry);
    return this.getSnapshot(input.workId);
  }

  /** 已有可刷新的令牌时直接完成；否则返回授权地址，由平台在系统浏览器中打开。 */
  async startSignIn(input: {
    workId: string | null;
    name: string;
  }): Promise<{ authorized: boolean; authorizationUrl?: string; snapshot: ManagedMcpSnapshot }> {
    const entry = await this.find(input.workId, input.name);
    if (!('url' in entry.config)) throw new Error(`MCP 服务“${input.name}”是本地进程，不需要登录`);
    const node = this.ensureNode(entry);
    const result = await this.oauth.startSignIn({
      nodeKey: entry.nodeKey,
      serverUrl: entry.config.url,
      oauthConfig: entry.config.oauth,
      challenge: node.lastChallenge,
      onAuthorized: () => this.renew(entry),
      onFailed: message => node.setLastError(message)
    });
    return { ...result, snapshot: await this.getSnapshot(input.workId) };
  }

  async submitRedirectUrl(input: {
    workId: string | null;
    name: string;
    redirectUrl: string;
  }): Promise<ManagedMcpSnapshot> {
    const entry = await this.find(input.workId, input.name);
    await this.oauth.submitRedirectUrl(entry.nodeKey, input.redirectUrl);
    return this.getSnapshot(input.workId);
  }

  async cancelSignIn(input: { workId: string | null; name: string }): Promise<ManagedMcpSnapshot> {
    this.oauth.cancelSignIn((await this.find(input.workId, input.name)).nodeKey);
    return this.getSnapshot(input.workId);
  }

  async signOut(input: { workId: string | null; name: string }): Promise<ManagedMcpSnapshot> {
    const entry = await this.find(input.workId, input.name);
    await this.oauth.removeCredentials(entry.nodeKey);
    await this.renew(entry);
    return this.getSnapshot(input.workId);
  }

  private sessionTransport(entry: ResolvedMcpServerEntry | undefined): McpTransport {
    if (!entry?.enabled) throw new McpConnectionClosedError();
    return this.ensureNode(entry).createVirtualTransport();
  }

  /** 接入共享连接的虚拟传输；多个会话不重复启动子进程。 */
  async createSessionTransport(workId: string | null, name: string): Promise<McpTransport> {
    return this.sessionTransport(await this.find(workId, name));
  }

  /** 会话的 MCP 扩展与授权查询；会话关闭时调用 dispose。 */
  async createSessionBridge(workId: string | null): Promise<SessionMcpBridge> {
    let entries = new Map<string, ResolvedMcpServerEntry>();
    let registered = new Set<string>();
    let api: ExtensionAPI | undefined;

    const register = () => {
      if (!api) return;
      const enabled = [...entries.values()].filter(entry => entry.enabled);
      for (const entry of enabled) {
        api.registerMcpServer(entry.name, sessionProjection(entry, this.epochs.get(entry.nodeKey) ?? 0));
      }
      const names = new Set(enabled.map(entry => entry.name));
      for (const name of registered) if (!names.has(name)) api.unregisterMcpServer(name);
      registered = names;
    };
    const sync = async () => {
      entries = new Map((await this.load(workId)).servers.map(entry => [entry.name, entry]));
      register();
    };
    await sync();
    const visible = () => [...entries.values()].filter(entry => entry.enabled && entry.exposure !== 'hidden');
    /** 工具名经过规范化和截断，不能反推所属服务；按 pi 注册时记录的命名空间确定。 */
    const serverTool = (toolName: string) => {
      const namespace = api?.getAllTools().find(tool => tool.name === toolName)?.namespace?.name;
      const server = visible().find(entry => mcpNamespace(entry.name) === namespace);
      const prefix = `${namespace}__`;
      return server && { server, toolName: toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName };
    };

    const record: BridgeRecord = { workId, sync };
    this.bridges.add(record);
    return {
      extensions: [
        pi => {
          api = pi;
          register();
        },
        createMcpExtension({
          loadConfig: () => ({ servers: [], errors: [] }),
          logPath: join(this.agentDir, 'mcp.log'),
          createTransport: ({ name }) => this.sessionTransport(entries.get(name))
        })
      ],
      targets: async (toolName, input) => {
        if (RESOURCE_TOOL_NAMES.has(toolName)) {
          const enabled = visible();
          const requested = (input as { server?: unknown } | null)?.server;
          if (typeof requested === 'string') {
            return enabled.filter(entry => entry.name === requested).map(server => ({ server, toolName }));
          }
          const nodes = enabled.map(entry => this.ensureNode(entry));
          await Promise.all(nodes.map(node => node.ensureConnected().catch(() => {})));
          return enabled.filter((_, index) => nodes[index]!.hasResources).map(server => ({ server, toolName }));
        }
        if (!toolName.startsWith(MCP_TOOL_PREFIX)) return undefined;
        const target = serverTool(toolName);
        if (!target) throw new Error('MCP 服务已停用或不存在');
        return [target];
      },
      describeCall: (toolName, input) => {
        if (RESOURCE_TOOL_NAMES.has(toolName)) {
          const server = (input as { server?: unknown } | null)?.server;
          return { ...(typeof server === 'string' && { server }), tool: toolName };
        }
        const target = toolName.startsWith(MCP_TOOL_PREFIX) ? serverTool(toolName) : undefined;
        return target && { server: target.server.name, tool: target.toolName };
      },
      dispose: () => {
        this.bridges.delete(record);
      }
    };
  }

  /** 作品移入回收站、被覆盖或永久删除时断开其专属连接；永久删除时一并清除作品级登录凭据。 */
  async closeWork(workId: string, options?: { purgeCredentials?: boolean }): Promise<void> {
    const prefix = `work:${workId}:`;
    await Promise.all([...this.nodes.keys()].filter(key => key.startsWith(prefix)).map(key => this.dropNode(key)));
    if (options?.purgeCredentials) await this.oauth.removeWorkCredentials(workId);
    this.onChange();
  }

  async close(): Promise<void> {
    this.oauth.close();
    this.bridges.clear();
    const nodes = [...this.nodes.values()];
    this.nodes.clear();
    await Promise.all(nodes.map(node => node.close()));
  }
}
