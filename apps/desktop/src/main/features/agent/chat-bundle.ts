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
import type { SubagentPool } from '../subagent/pool';
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
  taskRunner: import('../tasks/runner-port').TaskRunnerPort;
  /** skills 注入（SKILL.md 正文拼进 system 尾部）；缺省不注入。 */
  skillsProvider?: Pick<import('../skills/provider-port').SkillProvider, 'load'>;
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
        webToolsSettingsStore: deps.webToolsSettingsStore
      });

      // persona 白名单按 runtime 并集求值：内置工具与（未来的）扩展注册工具同过同一治理。
      const allowedToolNames = new Set([...selectedTools.builtinToolNames, ...selectedTools.customToolNames]);
      const tools: ToolDefinition[] = registered.filter(tool => allowedToolNames.has(tool.name));

      // 文件六工具：catalog 中 runtime=builtin 的六件套在此绑定为自有实现。
      tools.push(...createFileTools(input.cwd).filter(tool => allowedToolNames.has(tool.name)));

      const system = await composeChatSystemPrompt({
        personaBody,
        cwd: input.cwd,
        skillsProvider: deps.skillsProvider
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

/**
 * chat 系统提示词：标准四层 + 适用 skills 的 SKILL.md 正文。
 *
 * skills 三层目录（builtin < user < workspace）同名覆盖后按 persona 过滤，
 * 正文整篇拼入 system 尾部——skill 是流程指令，不是工具。
 */
async function composeChatSystemPrompt(options: {
  personaBody: string;
  cwd: string;
  skillsProvider?: Pick<import('../skills/provider-port').SkillProvider, 'load'>;
}): Promise<string> {
  const base = composeSystemPrompt({
    personaBody: options.personaBody,
    productDuty: PRODUCT_DUTY,
    memoryProtocol: MEMORY_PROTOCOL,
    todoProtocol: TODO_PROTOCOL
  });

  if (!options.skillsProvider) {
    return base;
  }

  try {
    const { skills } = await options.skillsProvider.load(options.cwd, 'companion');

    if (skills.length === 0) {
      return base;
    }

    const bodies = await Promise.all(
      skills.map(async skill => {
        const body = await readFile(skill.filePath, 'utf8').catch(() => '');
        const trimmed = body.trim();
        const bounded =
          trimmed.length > MAX_SKILL_BODY_CHARS
            ? `${trimmed.slice(0, MAX_SKILL_BODY_CHARS)}\n…（技能正文过长，已截断）`
            : trimmed;

        return bounded ? `<skill name="${skill.name}">\n${bounded}\n</skill>` : '';
      })
    );
    const skillSection = bodies.filter(Boolean).join('\n\n');

    return skillSection ? `${base}\n\n# Skills\n\n按需参考以下技能的流程约定：\n\n${skillSection}` : base;
  } catch {
    // skills 加载失败不阻塞对话（诊断由 SkillsProvider 内部记录）。
    return base;
  }
}
