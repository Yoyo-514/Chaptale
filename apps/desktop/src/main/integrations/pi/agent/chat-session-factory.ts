import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type InlineExtension
} from '@earendil-works/pi-coding-agent';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { PersonaDefinition, RiskLevel } from '@chaptale/shared';

import { MEMORY_PROTOCOL } from '../../../modules/memory/protocol';
import type { PermissionBroker } from '../../../modules/permissions/broker';
import type { PermissionRuleStore } from '../../../modules/permissions/rule-store';
import { builtinCompanionBody } from '../../../modules/personas/builtin';
import type { PersonaRegistry } from '../../../modules/personas/registry';
import { composeSystemPrompt } from '../../../modules/prompts/compose-system-prompt';
import { PRODUCT_DUTY } from '../../../modules/prompts/product-duty';
import type { BoundSession } from '../../../modules/session-ctx/types';
import type { SettingsService } from '../../../modules/settings/service';
import { TODO_PROTOCOL } from '../../../modules/todo/protocol';
import type { TodoStore } from '../../../modules/todo/store';
import type { ToolCatalog } from '../../../modules/tools/catalog';
import type { ToolDefinition } from '../../../modules/tools/definition';
import type { PiModelService } from '../models/service';
import { createPermissionGateExtension } from '../permissions/gate-extension';
import type { SkillsProvider } from '../skills/provider';
import { toPiToolDefinition } from '../tools/adapter';
import { createSessionCtx, findSessionById } from './session-locator';

const nodeRequire = createRequire(import.meta.url);

/** 会话级额外工具构建器：由组装层注入（如 delegate），解开与 TaskRunner 的构造环。 */
export type ChatSessionToolBuilder = (context: {
  sessionId: string;
  cwd: string;
  persona: PersonaDefinition;
}) => Promise<ToolDefinition[]>;

export type ChatSessionFactoryOptions = {
  settingsService: SettingsService;
  modelService: PiModelService;
  skillsProvider: SkillsProvider;
  todoStore: TodoStore;
  permissionBroker: PermissionBroker;
  permissionRuleStore: PermissionRuleStore;
  personaRegistry: PersonaRegistry;
  toolCatalog: ToolCatalog;
  buildChatTools: ChatSessionToolBuilder;
  /** 创作压缩扩展；cwd 固定为会话所属工作区，不能跟随当前 UI 工作区漂移。 */
  buildCompactExt: (sessionId: string, cwd: string) => InlineExtension;
};

/**
 * 把 Chaptale 会话 ID 解析成持久 chat AgentSession。
 *
 * 这里集中 pi SDK、ResourceLoader、SessionManager 相关细节，
 * 让 PiAgentService 只关心 runtime 缓存与事件流桥接。
 */
export class ChatSessionFactory {
  constructor(private readonly options: ChatSessionFactoryOptions) {}

  /** 解析当前工作区的 persona；内部会话能力与普通 persona 共用三层覆盖规则。 */
  getPersona(cwd: string, personaId: string) {
    return this.options.personaRegistry.get(cwd, personaId);
  }

  async create(sessionId: string): Promise<BoundSession<AgentSession>> {
    const {
      settingsService,
      modelService,
      skillsProvider,
      permissionBroker,
      permissionRuleStore,
      personaRegistry,
      toolCatalog,
      buildChatTools,
      buildCompactExt
    } = this.options;
    const target = await findSessionById(settingsService, sessionId);

    if (!target) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const ctx = createSessionCtx(sessionId, target);
    // persona、skills、工具授权与压缩上下文都必须绑定历史会话 cwd；
    // UI 当前 workspace 只能影响新建会话，不能改写已落盘会话的安全边界。
    const companion = await personaRegistry.get(ctx.cwd, 'companion');
    const personaBody = companion?.body ?? builtinCompanionBody;
    const sessionDir = path.dirname(target.path);
    const sessionManager = SessionManager.open(target.path, sessionDir, ctx.cwd);
    const settingsManager = SettingsManager.create(ctx.cwd, settingsService.agentDir);

    // pi-web-access 会读取 PI_CODING_AGENT_DIR/web-search.json；
    // 将其绑定到 Chaptale 自己的 agentDir，避免污染用户全局 ~/.pi 配置。
    process.env.PI_CODING_AGENT_DIR = settingsService.agentDir;

    // 会话级自定义工具：sessionId 在此已知，直接闭包绑定，todo 清单随会话隔离。
    // 构建于 loader 之前：权限闸门需要各自定义工具的风险分级。
    // 内置 chat persona 省略 tools = 使用目录默认全集；显式声明时才作为收窄白名单。
    const selectedTools = toolCatalog.selectSessionTools(
      companion ?? {
        id: 'companion',
        name: 'Companion',
        type: 'chat',
        execution: 'chat',
        body: personaBody,
        source: 'builtin'
      }
    );
    const registeredTools = companion ? await buildChatTools({ sessionId, cwd: ctx.cwd, persona: companion }) : [];
    const chatTools = registeredTools.filter(tool => selectedTools.customToolNames.includes(tool.name));
    const customTools = chatTools.map(toPiToolDefinition);
    const customRiskLevels = Object.fromEntries(
      chatTools.map(tool => [tool.name, tool.riskLevel ?? 'mutating'])
    ) as Record<string, RiskLevel>;

    // Chaptale 自己的角色 & 创作系统提示词，覆盖 pi 默认 coding 系统提示词；
    // 同时只定向加载白名单 pi package，避免把 pi CLI 的 coding 行为带进创作会话。
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
        buildCompactExt(sessionId, ctx.cwd)
      ],
      // 分层拼装：SYSTEM.md 仅替换 persona 层，职责/协议层始终保留；
      // 拼装结果在会话生命周期内不变（缓存安全）；APPEND_SYSTEM.md 由 pi 原生追加。
      systemPromptOverride: discovered =>
        composeSystemPrompt({
          personaBody,
          discoveredSystemMd: discovered,
          productDuty: PRODUCT_DUTY,
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
      tools: [...selectedTools.piToolNames, ...customTools.map(tool => tool.name)],
      customTools
    });

    return { session, ctx };
  }
}

function resolvePiPackageRoot(packageName: string): string {
  return path.dirname(nodeRequire.resolve(`${packageName}/package.json`));
}
