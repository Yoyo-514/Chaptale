import { readFile } from 'node:fs/promises';

import type { RiskLevel } from '@chaptale/shared';

import type { PermissionGatePort } from '../../core/agent/types';
import type { ResolvedModel } from '../../core/models/runtime';
import type { ModelService } from '../../core/models/service';
import type { SessionCtx } from '../../core/session-ctx/types';
import type { ToolCatalog } from '../../core/tool-protocol/catalog';
import type { ToolDefinition } from '../../core/tool-protocol/definition';
import { createFileTools } from '../file-tools/tools';
import type { MemoryPendingStore } from '../memory/pending/store';
import { MEMORY_PROTOCOL } from '../memory/protocol';
import type { PermissionBroker } from '../permissions/broker';
import { evaluatePermission } from '../permissions/engine';
import type { PermissionRuleStore } from '../permissions/rule-store';
import { builtinCompanionBody } from '../personas/builtin';
import type { PersonaRegistry } from '../personas/registry';
import { composeSystemPrompt } from '../prompts/compose-system-prompt';
import { PRODUCT_DUTY } from '../prompts/product-duty';
import type { MemorySearchService } from '../search/memory/service';
import type { SkillProvider, SkillDescriptor } from '../skills/provider-port';
import { SKILL_READ_TOOL_NAME } from '../skills/skill-read-tool';
import type { SubagentPool } from '../subagent/pool';
import type { TaskRunnerPort } from '../tasks/runner-port';
import { TODO_PROTOCOL } from '../todo/protocol';
import type { TodoStore } from '../todo/store';
import type { WebToolsSettingsStore } from '../web-tools/settings';
import type { ChatRuntimeBundle } from './service';
import { buildChatSessionTools } from './tool-assembly';

/** 单份 SKILL.md 正文注入上限：防大技能每轮烧 token。 */
const MAX_SKILL_BODY_CHARS = 16_000;

/**
 * chat 运行时装配：persona 解析 → 工具求交 → 系统提示词拼装 → 模型解析。
 * 每轮 resolve 重读配置（无会话级缓存失效问题）。
 */
export function createChatRuntimeBundle(deps: {
  personaRegistry: PersonaRegistry;
  taskRunner: TaskRunnerPort;
  /** skills 注入与 skill_read 通道；缺省不注入技能。 */
  skillsProvider?: Pick<SkillProvider, 'load'>;
  /**
   * skills 注入形态：
   * - on-demand（缺省）：system 只放索引（name + description 一行一条），模型用 skill_read 按需取正文；
   * - inline：SKILL.md 正文整篇拼入 system 尾部（历史形态，可回退）。
   */
  skillInjection?: 'inline' | 'on-demand';
  toolCatalog: ToolCatalog;
  todoStore: TodoStore;
  subagentPool: SubagentPool;
  memoryPendingStore: MemoryPendingStore;
  memorySearchService: MemorySearchService;
  webToolsSettingsStore: WebToolsSettingsStore;
  modelService: ModelService;
  /** 授权仲裁；缺省时不产出闸门，由装配层兜底。 */
  permissionBroker?: Pick<PermissionBroker, 'ask'>;
  permissionRuleStore?: Pick<PermissionRuleStore, 'collect'>;
}): ChatRuntimeBundle {
  return {
    resolveModel: () => resolveDefaultModel(deps.modelService),
    resolve: async input => {
      const companion = (await deps.personaRegistry.get(input.cwd, 'companion')) ?? {
        id: 'companion',
        name: 'Companion',
        type: 'chat' as const,
        execution: 'chat' as const,
        body: builtinCompanionBody,
        source: 'builtin' as const
      };
      const personaBody = companion.body ?? builtinCompanionBody;
      const selectedTools = deps.toolCatalog.selectSessionTools(companion);

      // 适用技能只加载一次：注入与 skill_read 通道共用同一份结果，避免两次 load 之间不一致。
      const { skills } = await loadChatSkills(deps.skillsProvider, input.cwd);

      const registered = await buildChatSessionTools({
        sessionId: input.sessionId,
        cwd: input.cwd,
        persona: companion,
        todoStore: deps.todoStore,
        getSessionId: () => input.sessionId,
        subagentPool: deps.subagentPool,
        taskRunner: deps.taskRunner,
        personaRegistry: deps.personaRegistry,
        memoryPendingStore: deps.memoryPendingStore,
        memorySearchService: deps.memorySearchService,
        webToolsSettingsStore: deps.webToolsSettingsStore,
        // 有适用技能才挂 skill_read：模型拿得到正文，通道才有意义。
        ...(deps.skillsProvider && skills.length > 0
          ? { skillRead: { provider: deps.skillsProvider, personaId: 'companion' } }
          : {})
      });

      // persona 白名单按 runtime 并集求值：内置工具与（未来的）扩展注册工具同过同一治理。
      // skill_read 例外：可用集由 appliesTo 过滤（load 时已收窄）决定，白名单不约束它——
      // 与 task 侧“声明了 skills 即获得读取通道”同语义，避免注入提示了工具却被白名单滤掉。
      const allowedToolNames = new Set([...selectedTools.builtinToolNames, ...selectedTools.customToolNames]);
      const tools: ToolDefinition[] = registered.filter(
        tool => allowedToolNames.has(tool.name) || tool.name === SKILL_READ_TOOL_NAME
      );

      // 文件六工具：catalog 中 runtime=builtin 的六件套在此绑定为自有实现。
      tools.push(...createFileTools(input.cwd).filter(tool => allowedToolNames.has(tool.name)));

      const system = composeChatSystemPrompt({
        personaBody,
        skills,
        mode: deps.skillInjection ?? 'on-demand'
      });

      const model = await resolveDefaultModel(deps.modelService);

      return {
        model,
        system,
        tools,
        // 闸门按轮绑定会话安全上下文：cwd 决定 workspace 级规则读哪个 .chaptale/permissions.json。
        ...(deps.permissionBroker && deps.permissionRuleStore
          ? {
              gate: createBrokerPermissionGate({
                broker: deps.permissionBroker,
                ruleStore: deps.permissionRuleStore,
                ctx: {
                  sessionId: input.sessionId,
                  cwd: input.cwd,
                  scope: input.cwd.trim() ? 'workspace' : 'global'
                }
              })
            }
          : {})
      };
    }
  };
}

/** 默认模型：models.json defaultModel；未配置时报可操作错误。 */
async function resolveDefaultModel(modelService: ModelService): Promise<ResolvedModel> {
  const config = await modelService.listModels();
  const ref = config.defaultModel;

  if (!ref) {
    throw new Error('未配置默认模型：请在设置中添加模型提供方并选择默认模型');
  }

  return modelService.runtime.resolveModel(ref.provider, ref.modelId);
}

/**
 * 参数摘要：规则 `tool(参数前缀*)` 形式按此比对，因此必须是工具的**主参数**而非整包 JSON
 * （整包 JSON 会让参数级规则永远匹配不上）。按工具族的主参数名依次探测，兜底截断 JSON。
 */
const SUBJECT_KEYS = ['path', 'file_path', 'filePath', 'url', 'query', 'command'] as const;

export function toPermissionSubject(args: Record<string, unknown>): string {
  for (const key of SUBJECT_KEYS) {
    const value = args[key];

    if (typeof value === 'string' && value.trim()) {
      return value.slice(0, 200);
    }
  }

  return JSON.stringify(args).slice(0, 200);
}

/**
 * PermissionBroker + 规则库 → core/agent 权限闸门端口。
 *
 * 求值顺序是三层规则先行、broker 兜底：allow 直行、deny 直接拒绝、ask 才弹授权卡片——
 * 否则「本工作区始终允许」落库后依然每次弹卡，deny 规则与 destructive 默认拒绝也永不生效。
 * ctx 必须是发起本次调用的会话上下文（cwd 决定读哪个工作区的 permissions.json），
 * 不能用 UI 当前工作区，也不能留空。
 */
export function createBrokerPermissionGate(deps: {
  broker: Pick<PermissionBroker, 'ask'>;
  ruleStore: Pick<PermissionRuleStore, 'collect'>;
  ctx: SessionCtx;
}): PermissionGatePort {
  return {
    check: async input => {
      const request = {
        toolName: input.toolName,
        riskLevel: input.riskLevel as RiskLevel,
        subject: toPermissionSubject(input.args)
      };
      const action = evaluatePermission(request, await deps.ruleStore.collect(deps.ctx));

      if (action === 'allow') {
        return { outcome: 'allow-once' };
      }

      if (action === 'deny') {
        return { outcome: 'deny', reason: `已被授权规则拒绝：${input.toolName}` };
      }

      const decision = await deps.broker.ask({
        ctx: deps.ctx,
        ...request,
        // 取消运行时授权随之作废；否则被闸门挂起的工具会一直等到 broker 超时。
        ...(input.signal ? { signal: input.signal } : {})
      });

      if (decision.outcome === 'deny') {
        return { outcome: 'deny', reason: decision.reason };
      }

      return { outcome: 'allow-once' };
    }
  };
}

/** chat 侧已加载并读入正文的技能（body 供 inline 注入；on-demand 只用索引字段）。 */
export type ChatLoadedSkill = SkillDescriptor & { body: string };

/**
 * chat 系统提示词：标准四层 + 适用 skills。
 *
 * skills 三层目录（builtin < user < workspace）同名覆盖后按 companion 过滤。
 * 两种形态见 skillInjection：on-demand 只注入索引（上下文友好），
 * inline 注入正文（历史形态）。加载失败不阻塞对话，降级为空技能集。
 */
function composeChatSystemPrompt(options: {
  personaBody: string;
  skills: ChatLoadedSkill[];
  mode: 'inline' | 'on-demand';
}): string {
  const base = composeSystemPrompt({
    personaBody: options.personaBody,
    productDuty: PRODUCT_DUTY,
    memoryProtocol: MEMORY_PROTOCOL,
    todoProtocol: TODO_PROTOCOL
  });

  if (options.skills.length === 0) {
    return base;
  }

  if (options.mode === 'inline') {
    const skillSection = options.skills
      .map(skill => {
        const trimmed = skill.body.trim();
        const bounded =
          trimmed.length > MAX_SKILL_BODY_CHARS
            ? `${trimmed.slice(0, MAX_SKILL_BODY_CHARS)}\n…（技能正文过长，已截断）`
            : trimmed;

        return bounded ? `<skill name="${skill.name}">\n${bounded}\n</skill>` : '';
      })
      .filter(Boolean)
      .join('\n\n');

    return skillSection ? `${base}\n\n# Skills\n\n按需参考以下技能的流程约定：\n\n${skillSection}` : base;
  }

  const index = options.skills.map(skill => `- ${skill.name}：${skill.description}`).join('\n');

  return `${base}\n\n# Skills\n\n可用技能（执行前用 skill_read 读取相关技能正文，再遵循其流程）：\n${index}`;
}

/** 适用技能加载：加载失败降级为空集（诊断由 SkillsProvider 内部记录），不阻塞对话。 */
async function loadChatSkills(
  skillsProvider: Pick<SkillProvider, 'load'> | undefined,
  cwd: string
): Promise<{ skills: ChatLoadedSkill[] }> {
  if (!skillsProvider) {
    return { skills: [] };
  }

  try {
    const { skills } = await skillsProvider.load(cwd, 'companion');
    const withBodies = await Promise.all(
      skills.map(async skill => ({
        name: skill.name,
        description: skill.description,
        filePath: skill.filePath,
        body: await readFile(skill.filePath, 'utf8').catch(() => '')
      }))
    );

    return { skills: withBodies };
  } catch {
    return { skills: [] };
  }
}
