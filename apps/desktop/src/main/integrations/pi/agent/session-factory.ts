import {
  createAgentSession,
  DefaultResourceLoader,
  parseFrontmatter,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type SessionInfo
} from '@earendil-works/pi-coding-agent';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { unique } from 'radash';

import type { RiskLevel } from '@chaptale/shared';

import { MEMORY_PROTOCOL } from '../../../modules/memory/protocol';
import type { PermissionBroker } from '../../../modules/permissions/broker';
import type { PermissionRuleStore } from '../../../modules/permissions/rule-store';
import { builtinCompanionBody, builtinPersonaSources } from '../../../modules/personas/builtin';
import { PersonaRegistry } from '../../../modules/personas/registry';
import type { TaskPersonaSpec } from '../../../modules/personas/task-spec';
import { composeSystemPrompt } from '../../../modules/prompts/compose-system-prompt';
import type { SettingsService } from '../../../modules/settings/service';
import { TODO_PROTOCOL } from '../../../modules/todo/protocol';
import type { TodoStore } from '../../../modules/todo/store';
import { buildChatSessionTools } from '../../../modules/tools/tool-registry';
import type { PiModelService } from '../models/service';
import { createPermissionGateExtension } from '../permissions/gate-extension';
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
  private personaRegistry?: PersonaRegistry;

  constructor(private readonly options: PiAgentSessionFactoryOptions) {}

  /** 懒初始化：构造时不碰 settingsService 路径，保持构造函数零副作用。 */
  private getPersonaRegistry(): PersonaRegistry {
    this.personaRegistry ??= this.options.personaRegistry ?? createDefaultPersonaRegistry(this.options.settingsService);
    return this.personaRegistry;
  }

  async create(sessionId: string): Promise<AgentSession> {
    const { settingsService, modelService, skillsProvider, todoStore, permissionBroker, permissionRuleStore } =
      this.options;
    const target = await findSessionById(settingsService, sessionId);

    if (!target) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const cwd = target.cwd || (await settingsService.getCurrentCwd());
    // 会话 cwd 保持历史文件语境；Slash 菜单、skills 与 persona 明确跟随当前工作区。
    const skillsCwd = await settingsService.getCurrentCwd();
    // 主对话固定 companion persona；文件缺失/非法时回退内置默认值，不阻塞会话创建。
    const companion = await this.getPersonaRegistry().get(skillsCwd, 'companion');
    const personaBody = companion?.body ?? builtinCompanionBody;
    const sessionDir = path.dirname(target.path);
    const sessionManager = SessionManager.open(target.path, sessionDir, cwd);
    const settingsManager = SettingsManager.create(cwd, settingsService.agentDir);

    // pi-web-access 会读取 PI_CODING_AGENT_DIR/web-search.json；
    // 将其绑定到 Chaptale 自己的 agentDir，避免污染用户全局 ~/.pi 配置。
    process.env.PI_CODING_AGENT_DIR = settingsService.agentDir;

    // Chaptale 自己的角色 & 创作系统提示词，覆盖 pi 默认 coding 系统提示词；
    // 同时只定向加载白名单 pi package，避免把 pi CLI 的 coding 行为带进创作会话。
    // 会话级自定义工具：sessionId 在此已知，直接闭包绑定，todo 清单随会话隔离。
    // 构建于 loader 之前：权限闸门需要各自定义工具的风险分级。
    const chatTools = buildChatSessionTools({ todoStore, getSessionId: () => sessionId });
    const customTools = chatTools.map(toPiToolDefinition);
    const customRiskLevels = Object.fromEntries(
      chatTools.map(tool => [tool.name, tool.riskLevel ?? 'mutating'])
    ) as Record<string, RiskLevel>;

    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: settingsService.agentDir,
      settingsManager,
      additionalExtensionPaths: [resolvePiPackageRoot('pi-web-access')],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      skillsOverride: () => skillsProvider.load(skillsCwd, 'companion'),
      // 权限闸门：拦截全部工具调用；noExtensions 只关磁盘发现，不影响 inline factory。
      extensionFactories: [
        createPermissionGateExtension({
          sessionId,
          broker: permissionBroker,
          ruleStore: permissionRuleStore,
          customRiskLevels,
          interactive: true
        })
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
      cwd,
      agentDir: settingsService.agentDir,
      modelRuntime: await modelService.getModelRuntime(),
      sessionManager,
      settingsManager,
      resourceLoader,
      // 创作场景：启用显式白名单工具。read/grep/find/ls/write/edit 用于工作区与文件能力；bash 暂不开放。
      // 白名单为全量控制语义，自定义工具名需一并列入才会启用。
      tools: [...getEnabledToolNames(), ...customTools.map(tool => tool.name)],
      customTools
    });

    return session;
  }

  /**
   * 为 task 型 persona 创建一次性 AgentSession。
   *
   * 与主对话路径的差异：
   * - session 文件落在 taskSessionsDir（不在历史扫描范围）；
   * - 逐次新建不缓存，工具 schema 天然每次重算；
   * - 系统提示词仅含 persona 正文，不受用户 SYSTEM.md/APPEND_SYSTEM.md 与 skills 影响
   *   （task 行为由 persona 定义，不被全局自定义劫持）；
   *   memory 协议也不注入——task 会话零工具零记忆通道，协议只会误导模型；
   * - 工具为 spec 白名单子集（[] = 纯分析）；模型按 spec 偏好解析，缺省跟随全局默认。
   */
  async createTaskSession(spec: TaskPersonaSpec): Promise<AgentSession> {
    const { settingsService, modelService, permissionBroker, permissionRuleStore } = this.options;
    const cwd = await settingsService.getCurrentCwd();
    await fs.mkdir(settingsService.taskSessionsDir, { recursive: true });
    const sessionManager = SessionManager.create(cwd, settingsService.taskSessionsDir);
    const settingsManager = SettingsManager.create(cwd, settingsService.agentDir);

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
          sessionId: `task-${Date.now()}`,
          broker: permissionBroker,
          ruleStore: permissionRuleStore,
          customRiskLevels: {},
          interactive: false
        })
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
