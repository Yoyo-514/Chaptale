import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type InlineExtension
} from '@earendil-works/pi-coding-agent';
import { promises as fs } from 'node:fs';

import type { RiskLevel } from '@chaptale/shared';

import type { SessionCtx } from '../../../core/session-ctx/types';
import type { SettingsService } from '../../../core/settings/service';
import type { ToolDefinition } from '../../../core/tool-protocol/definition';
import type { PermissionBroker } from '../../../features/permissions/broker';
import type { PermissionRuleStore } from '../../../features/permissions/rule-store';
import type { TaskPersonaSpec } from '../../../features/personas/task-spec';
import { composeSystemPrompt } from '../../../features/prompts/compose-system-prompt';
import type { TaskSessionFactoryPort } from '../../../features/tasks/runner-port';
import type { PiModelService } from '../models/service';
import { createPermissionGateExtension } from '../permissions/gate-extension';
import { toPiToolDefinition } from '../tools/adapter';

/** task 自定义工具仍受 spec.tools 白名单约束，builder 不能越权扩大 persona 能力。 */
export type TaskSessionToolBuilder = (spec: TaskPersonaSpec, cwd: string) => Promise<ToolDefinition[]>;

export type TaskSessionFactoryOptions = {
  settingsService: SettingsService;
  modelService: PiModelService;
  permissionBroker: PermissionBroker;
  permissionRuleStore: PermissionRuleStore;
  buildTaskTools: TaskSessionToolBuilder;
};

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
export class TaskSessionFactory implements TaskSessionFactoryPort<AgentSession> {
  constructor(private readonly options: TaskSessionFactoryOptions) {}

  async createTaskSession(spec: TaskPersonaSpec, cwdOverride?: string): Promise<AgentSession> {
    const { settingsService, modelService, permissionBroker, permissionRuleStore, buildTaskTools } = this.options;
    const cwd = cwdOverride ?? (await settingsService.getCurrentCwd());
    await fs.mkdir(settingsService.taskSessionsDir, { recursive: true });
    const sessionManager = SessionManager.create(cwd, settingsService.taskSessionsDir);
    const settingsManager = SettingsManager.create(cwd, settingsService.agentDir);
    const declaredTools = new Set(spec.tools);
    const taskTools = (await buildTaskTools(spec, cwd)).filter(tool => declaredTools.has(tool.name));
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
