import { randomUUID } from 'node:crypto';

import type { PermissionGatePort } from '../../core/agent/types';
import type { ResolvedModel } from '../../core/models/runtime';
import type { ModelService } from '../../core/models/service';
import type { SettingsService } from '../../core/settings/service';
import type { ToolDefinition } from '../../core/tool-protocol/definition';
import type { TaskPersonaSpec } from '../personas/task-spec';
import { composeSystemPrompt } from '../prompts/compose-system-prompt';
import type { SkillProvider } from '../skills/provider-port';
import type { TaskSessionFactoryPort } from './runner-port';
import { createTaskSession, type TaskSession } from './session';

/** task 自定义工具仍受 spec.tools 白名单约束，builder 不能越权扩大 persona 能力。 */
export type TaskSessionToolBuilder = (
  spec: TaskPersonaSpec,
  cwd: string,
  onMemoryRead?: (refs: readonly string[]) => void
) => Promise<ToolDefinition[]>;

export type TaskSessionFactoryOptions = {
  settingsService: SettingsService;
  modelService: ModelService;
  buildTaskTools: TaskSessionToolBuilder;
  /** skills 查找端口；缺省不注入 skills 摘要。与 chat 侧共用同一 provider，保证三层目录一致。 */
  skillsProvider?: Pick<SkillProvider, 'load'>;
};

/**
 * 为 task 型 persona 创建一次性自有 TaskSession。
 *
 * 与 chat 链路的差异：
 * - 不落盘（task 会话不进历史扫描），多轮修复在内存消息上继续；
 * - 系统提示词仅含 persona 正文 + spec 绑定的 skills 摘要，不受用户 SYSTEM.md 影响；
 * - 工具为 spec 白名单子集（[] = 纯分析），自定义工具也不能越过该白名单；
 * - 无人值守：gate 只放行 readonly，其余一律拒绝（不弹授权）；
 * - 模型按 spec 偏好解析，缺省跟随全局默认。
 */
export class TaskSessionFactory implements TaskSessionFactoryPort<TaskSession> {
  constructor(private readonly options: TaskSessionFactoryOptions) {}

  async createTaskSession(
    spec: TaskPersonaSpec,
    cwdOverride?: string,
    onMemoryRead?: (refs: readonly string[]) => void
  ): Promise<TaskSession> {
    const { settingsService, modelService, buildTaskTools } = this.options;
    const cwd = cwdOverride ?? (await settingsService.getCurrentCwd());
    const declaredTools = new Set(spec.tools);
    const taskTools = (await buildTaskTools(spec, cwd, onMemoryRead)).filter(tool => declaredTools.has(tool.name));

    const model = await resolveTaskModel(modelService, spec.modelPreference);
    const system = await composeTaskSystemPrompt(this.options.skillsProvider, cwd, spec);
    const gate = createUnattendedGate();

    return createTaskSession({
      // 并发子任务默认 3，同毫秒创建会撞 id，因此不能用时间戳。
      sessionId: `task-${randomUUID()}`,
      model,
      system,
      tools: taskTools,
      gate
    });
  }
}

/** 解析 persona 模型偏好："provider/modelId" 显式指定；缺省或不存在时跟随全局默认（分享的 persona 模型配置因人而异，降级不失败）。 */
async function resolveTaskModel(modelService: ModelService, preference: string | undefined): Promise<ResolvedModel> {
  if (preference?.includes('/')) {
    const separator = preference.indexOf('/');

    try {
      return await modelService.runtime.resolveModel(preference.slice(0, separator), preference.slice(separator + 1));
    } catch {
      // 指定模型不存在：降级全局默认。
    }
  }

  const config = await modelService.listModels();
  const ref = config.defaultModel;

  if (!ref) {
    throw new Error('尚未配置可用模型：请在设置面板 LLM Provider 中配置凭据并选择默认模型');
  }

  return modelService.runtime.resolveModel(ref.provider, ref.modelId);
}

/** task 系统提示词：persona 正文 + 绑定 skills 的名称/描述摘要。 */
async function composeTaskSystemPrompt(
  skillsProvider: Pick<SkillProvider, 'load'> | undefined,
  cwd: string,
  spec: TaskPersonaSpec
): Promise<string> {
  const layers = [composeSystemPrompt({ personaBody: spec.systemPrompt })];

  if (skillsProvider && spec.skills.length > 0) {
    const selected = await loadSkillsForTask(skillsProvider, cwd, spec);

    if (selected.length > 0) {
      const skillLines = selected.map(skill => `- ${skill.name}：${skill.description}`);
      layers.push(`可用 skills（按需引用其流程约定）：\n${skillLines.join('\n')}`);
    }
  }

  return layers.join('\n\n');
}

/**
 * spec 绑定 skills 的名称/描述摘要。
 *
 * 走与 chat 侧同一个 SkillsProvider：自行拼 user + workspace 两层会漏掉 builtin，
 * 内置创作 skills 将对 task/subagent persona 不可见。
 * 不传 personaId：spec.skills 是显式声明，优先于 appliesTo 过滤。
 */
async function loadSkillsForTask(
  skillsProvider: Pick<SkillProvider, 'load'>,
  cwd: string,
  spec: TaskPersonaSpec
): Promise<Array<{ name: string; description: string }>> {
  const { skills } = await skillsProvider.load(cwd);
  const byName = new Map(skills.map(skill => [skill.name, skill]));

  return spec.skills.flatMap(name => {
    const skill = byName.get(name);
    return skill ? [{ name: skill.name, description: skill.description }] : [];
  });
}

/** 无人值守闸门：readonly 直行，其余一律拒绝（不弹授权、不挂起）。 */
function createUnattendedGate(): PermissionGatePort {
  return {
    check: async input =>
      input.riskLevel === 'readonly'
        ? { outcome: 'allow-once' }
        : { outcome: 'deny', reason: 'task 会话无人值守，不授权高风险工具' }
  };
}
