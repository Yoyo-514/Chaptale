import {
  createAgentSession,
  DefaultResourceLoader,
  parseFrontmatter,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type InlineExtension,
  type SessionInfo
} from '@earendil-works/pi-coding-agent';

// 供接线层（app-context）注入到 pi-free 模块的 frontmatter 解析端口；
// 统一经 integrations 导出，避免 app 层直接依赖 pi 包。
export { parseFrontmatter as piParseFrontmatter } from '@earendil-works/pi-coding-agent';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { unique } from 'radash';

import type { PersonaDefinition, RiskLevel } from '@chaptale/shared';

import { MEMORY_PROTOCOL } from '../../../modules/memory/protocol';
import type { PermissionBroker } from '../../../modules/permissions/broker';
import type { PermissionRuleStore } from '../../../modules/permissions/rule-store';
import { builtinCompanionBody, builtinPersonaSources } from '../../../modules/personas/builtin';
import { PersonaRegistry } from '../../../modules/personas/registry';
import type { TaskPersonaSpec } from '../../../modules/personas/task-spec';
import { resolveAllowedPersonaTools } from '../../../modules/personas/tool-access';
import { composeSystemPrompt } from '../../../modules/prompts/compose-system-prompt';
import type { BoundSession, SessionCtx } from '../../../modules/session-ctx/types';
import type { SettingsService } from '../../../modules/settings/service';
import { TODO_PROTOCOL } from '../../../modules/todo/protocol';
import type { TodoStore } from '../../../modules/todo/store';
import type { ToolDefinition } from '../../../modules/tools/definition';
import type { PiModelService } from '../models/service';
import { createPermissionGateExtension } from '../permissions/gate-extension';
import { getSessionScope } from '../sessions/storage';
import type { SkillsProvider } from '../skills/provider';
import { toPiToolDefinition } from '../tools/adapter';
import { getEnabledToolNames } from '../tools/tool-whitelist';

const nodeRequire = createRequire(import.meta.url);

export type PiAgentSessionFactoryOptions = {
  settingsService: SettingsService;
  modelService: PiModelService;
  skillsProvider: SkillsProvider;
  todoStore: TodoStore;
  permissionBroker: PermissionBroker;
  permissionRuleStore: PermissionRuleStore;
  personaRegistry?: PersonaRegistry;
};

/** desktop 默认 persona 注册表：pi frontmatter 解析 + 构建期内置 persona + 用户级目录。 */
export function createDefaultPersonaRegistry(settingsService: SettingsService): PersonaRegistry {
  return new PersonaRegistry({
    parseFrontmatter,
    builtinSources: builtinPersonaSources,
    userPersonasDir: path.join(settingsService.rootDir, 'personas')
  });
}

/**
 * 负责把 Chaptale 会话 ID 解析成 pi AgentSession。
 *
 * 这里集中 pi SDK、ResourceLoader、SessionManager 相关细节，
 * 让 PiAgentService 只关心 runtime 缓存与事件流桥接。
 */
export class PiAgentSessionFactory {
  /** 会话级额外工具构建器：由 app 组装层注入（如 delegate），解开与 TaskRunner 的构造环。 */
  private extraChatTools?: (context: {
    sessionId: string;
    cwd: string;
    persona: PersonaDefinition;
  }) => Promise<ToolDefinition[]>;
  private extraTaskTools?: (spec: TaskPersonaSpec, cwd: string) => Promise<ToolDefinition[]>;

  /** 注册额外的 chat 会话工具构建器；仅对注册后新建的会话生效。 */
  setExtraChatTools(
    builder: (context: { sessionId: string; cwd: string; persona: PersonaDefinition }) => Promise<ToolDefinition[]>
  ): void {
    this.extraChatTools = builder;
  }

  /** task 自定义工具仍受 spec.tools 白名单约束，builder 不能越权扩大 persona 能力。 */
  setExtraTaskTools(builder: (spec: TaskPersonaSpec, cwd: string) => Promise<ToolDefinition[]>): void {
    this.extraTaskTools = builder;
  }

  private compactExt?: (sessionId: string, cwd: string) => InlineExtension;

  /** late-bind 创作压缩扩展，cwd 固定为会话所属工作区，不能跟随当前 UI 工作区漂移。 */
  setCompactExt(builder: (sessionId: string, cwd: string) => InlineExtension): void {
    this.compactExt = builder;
  }

  private personaRegistry?: PersonaRegistry;

  constructor(private readonly options: PiAgentSessionFactoryOptions) {}

  /** 懒初始化：构造时不碰 settingsService 路径，保持构造函数零副作用。 */
  private getPersonaRegistry(): PersonaRegistry {
    this.personaRegistry ??= this.options.personaRegistry ?? createDefaultPersonaRegistry(this.options.settingsService);
    return this.personaRegistry;
  }

  /** 解析当前工作区的 persona；内部会话能力与普通 persona 共用三层覆盖规则。 */
  getPersona(cwd: string, personaId: string) {
    return this.getPersonaRegistry().get(cwd, personaId);
  }

  async create(sessionId: string): Promise<BoundSession<AgentSession>> {
    const { settingsService, modelService, skillsProvider, permissionBroker, permissionRuleStore } = this.options;
    const target = await findSessionById(settingsService, sessionId);

    if (!target) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const ctx = this.createSessionCtx(sessionId, target);
    // persona、skills、工具授权与压缩上下文都必须绑定历史会话 cwd；
    // UI 当前 workspace 只能影响新建会话，不能改写已落盘会话的安全边界。
    const companion = await this.getPersonaRegistry().get(ctx.cwd, 'companion');
    const personaBody = companion?.body ?? builtinCompanionBody;
    const sessionDir = path.dirname(target.path);
    const sessionManager = SessionManager.open(target.path, sessionDir, ctx.cwd);
    const settingsManager = SettingsManager.create(ctx.cwd, settingsService.agentDir);

    // pi-web-access 会读取 PI_CODING_AGENT_DIR/web-search.json；
    // 将其绑定到 Chaptale 自己的 agentDir，避免污染用户全局 ~/.pi 配置。
    process.env.PI_CODING_AGENT_DIR = settingsService.agentDir;

    // Chaptale 自己的角色 & 创作系统提示词，覆盖 pi 默认 coding 系统提示词；
    // 同时只定向加载白名单 pi package，避免把 pi CLI 的 coding 行为带进创作会话。
    // 会话级自定义工具：sessionId 在此已知，直接闭包绑定，todo 清单随会话隔离。
    // 构建于 loader 之前：权限闸门需要各自定义工具的风险分级。
    // 内置 chat persona 省略 tools = 使用 registry 默认全集；显式声明时才作为收窄白名单。
    const allowedTools = companion?.tools ? new Set(resolveAllowedPersonaTools(companion)) : undefined;
    const registeredTools =
      companion && this.extraChatTools
        ? await this.extraChatTools({ sessionId, cwd: ctx.cwd, persona: companion })
        : [];
    const chatTools = registeredTools.filter(tool => !allowedTools || allowedTools.has(tool.name));
    const enabledPiTools = getEnabledToolNames().filter(tool => !allowedTools || allowedTools.has(tool));
    const customTools = chatTools.map(toPiToolDefinition);
    const customRiskLevels = Object.fromEntries(
      chatTools.map(tool => [tool.name, tool.riskLevel ?? 'mutating'])
    ) as Record<string, RiskLevel>;

    const resourceLoader = new DefaultResourceLoader({
      cwd: ctx.cwd,
      agentDir: settingsService.agentDir,
      settingsManager,
      additionalExtensionPaths: [resolvePiPackageRoot('pi-web-access')],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      skillsOverride: () => skillsProvider.load(ctx.cwd, 'companion'),
      // 权限闸门：拦截全部工具调用；noExtensions 只关磁盘发现，不影响 inline factory。
      extensionFactories: [
        createPermissionGateExtension({
          ctx,
          broker: permissionBroker,
          ruleStore: permissionRuleStore,
          customRiskLevels,
          interactive: true
        }),
        ...(this.compactExt ? [this.compactExt(sessionId, ctx.cwd)] : [])
      ],
      // 分层拼装：SYSTEM.md 仅替换 persona 层，职责/协议层始终保留；
      // 拼装结果在会话生命周期内不变（缓存安全）；APPEND_SYSTEM.md 由 pi 原生追加。
      systemPromptOverride: discovered =>
        composeSystemPrompt({
          personaBody,
          discoveredSystemMd: discovered,
          memoryProtocol: MEMORY_PROTOCOL,
          todoProtocol: TODO_PROTOCOL
        })
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: ctx.cwd,
      agentDir: settingsService.agentDir,
      modelRuntime: await modelService.getModelRuntime(),
      sessionManager,
      settingsManager,
      resourceLoader,
      // persona.tools 是全量能力边界；Pi 内置、package 与自定义工具统一求交，未知工具不会启用。
      tools: [...enabledPiTools, ...customTools.map(tool => tool.name)],
      customTools
    });

    return { session, ctx };
  }

  /**
   * 为 task 型 persona 创建一次性 AgentSession。
   *
   * 与主对话路径的差异：
   * - session 文件落在 taskSessionsDir（不在历史扫描范围）；
   * - 逐次新建不缓存，工具 schema 天然每次重算；
   * - 系统提示词仅含 persona 正文，不受用户 SYSTEM.md/APPEND_SYSTEM.md 与 skills 影响
   *   （task 行为由 persona 定义，不被全局自定义劫持）；
   *   memory 写协议不注入；只读检索由显式工具 schema 自描述，避免给纯分析任务加入无关协议；
   * - 工具为 spec 白名单子集（[] = 纯分析），自定义工具也不能越过该白名单；模型按 spec 偏好解析，缺省跟随全局默认。
   */
  async createTaskSession(spec: TaskPersonaSpec, cwdOverride?: string): Promise<AgentSession> {
    const { settingsService, modelService, permissionBroker, permissionRuleStore } = this.options;
    const cwd = cwdOverride ?? (await settingsService.getCurrentCwd());
    await fs.mkdir(settingsService.taskSessionsDir, { recursive: true });
    const sessionManager = SessionManager.create(cwd, settingsService.taskSessionsDir);
    const settingsManager = SettingsManager.create(cwd, settingsService.agentDir);
    const declaredTools = new Set(spec.tools);
    const taskTools = (this.extraTaskTools ? await this.extraTaskTools(spec, cwd) : []).filter(tool =>
      declaredTools.has(tool.name)
    );
    const customTools = taskTools.map(toPiToolDefinition);
    const customRiskLevels = Object.fromEntries(
      taskTools.map(tool => [tool.name, tool.riskLevel ?? 'mutating'])
    ) as Record<string, RiskLevel>;

    const taskCtx: SessionCtx = { sessionId: `task-${Date.now()}`, cwd, scope: 'workspace' };

    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: settingsService.agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      skillsOverride: () => ({ skills: [], diagnostics: [] }),
      // task 会话无人值守：闸门仍拦截，但 ask 一律按拒绝处理，不会挂起等待授权。
      extensionFactories: [
        createPermissionGateExtension({
          ctx: taskCtx,
          broker: permissionBroker,
          ruleStore: permissionRuleStore,
          customRiskLevels,
          interactive: false
        }),
        createTaskNoCompactExt()
      ],
      appendSystemPromptOverride: () => [],
      systemPromptOverride: () => composeSystemPrompt({ personaBody: spec.systemPrompt })
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd,
      agentDir: settingsService.agentDir,
      modelRuntime: await modelService.getModelRuntime(),
      sessionManager,
      settingsManager,
      resourceLoader,
      tools: spec.tools,
      customTools,
      ...(spec.tools.length === 0 ? { noTools: 'all' as const } : {})
    });

    const model = await this.resolveTaskModel(spec.modelPreference);

    if (model && (session.model?.provider !== model.provider || session.model?.id !== model.id)) {
      await session.setModel(model);
    }

    if (!session.model) {
      throw new Error('尚未配置可用模型：请在设置面板 LLM Provider 中配置凭据并选择默认模型');
    }

    return session;
  }

  /** 从持久化 session 元数据恢复安全上下文，拒绝缺失 cwd 的历史会话。 */
  private createSessionCtx(sessionId: string, target: SessionInfo): SessionCtx {
    if (!target.cwd?.trim()) {
      throw new Error(`会话缺少 workspace，无法安全恢复：${sessionId}`);
    }

    return {
      sessionId,
      cwd: target.cwd,
      scope: getSessionScope(path.dirname(target.path))
    };
  }

  /** 解析 persona 模型偏好："provider/modelId" 显式指定；fast/quality 映射尚未实现，当前跟随全局默认。 */
  private async resolveTaskModel(preference: string | undefined) {
    const { modelService } = this.options;

    if (preference?.includes('/')) {
      const separator = preference.indexOf('/');
      const modelRuntime = await modelService.getModelRuntime();
      const model = modelRuntime.getModel(preference.slice(0, separator), preference.slice(separator + 1));

      if (model) {
        return model;
      }
      // 指定模型不存在时降级全局默认（而非失败）：persona 文件可能来自分享，模型配置因人而异。
    }

    return modelService.getDefaultPiModel();
  }
}

/** 一次性 task 不允许用 coding 摘要自救；溢出应由调用方缩减输入后重试。 */
function createTaskNoCompactExt(): InlineExtension {
  return {
    name: 'chaptale-task-no-compact',
    hidden: true,
    factory: pi => {
      pi.on('session_before_compact', async () => ({ cancel: true }));
    }
  };
}

function resolvePiPackageRoot(packageName: string): string {
  return path.dirname(nodeRequire.resolve(`${packageName}/package.json`));
}

async function findSessionById(settingsService: SettingsService, sessionId: string): Promise<SessionInfo | undefined> {
  const sessionDirs = await getKnownSessionDirs(settingsService);

  for (const sessionDir of sessionDirs) {
    const sessions = await SessionManager.listAll(sessionDir);
    const target = sessions.find(item => item.id === sessionId);

    if (target) {
      return target;
    }
  }

  return undefined;
}

async function getKnownSessionDirs(settingsService: SettingsService) {
  const currentSessionDir = await settingsService.getCurrentSessionDir();
  await fs.mkdir(settingsService.sessionsRootDir, { recursive: true });

  const entries = await fs.readdir(settingsService.sessionsRootDir, { withFileTypes: true });
  const dirs = entries
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(settingsService.sessionsRootDir, entry.name));

  return unique([currentSessionDir, ...dirs]);
}
