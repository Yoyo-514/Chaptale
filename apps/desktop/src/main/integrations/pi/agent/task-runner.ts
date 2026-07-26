import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { createHash, randomUUID } from 'node:crypto';

import { extractTaskOutput, validateOutput } from '@chaptale/shared';

import { estimateTextTokens, fitTextToTokens } from '../../../core/context/token-counter';
import type { ToolCatalog } from '../../../core/tool-protocol/catalog';
import { resolveTaskSpec } from '../../../features/personas/task-spec';
import type { AgentRunRecord } from '../../../features/runs/record';
import type { AgentRunStore } from '../../../features/runs/store';
import type {
  TaskRunnerPort,
  TaskRunRequest,
  TaskRunResult,
  TaskRunUsage,
  TaskSessionFactoryPort
} from '../../../features/tasks/runner-port';

/** 校验失败后允许模型自我修复的最大次数。 */
const MAX_REPAIR_ATTEMPTS = 2;

/**
 * task 型 persona 的执行器。
 *
 * 单次流程：解析执行规格 → 一次性 task session → 结构化输出提取与校验 →
 * 校验失败携错误反馈让模型修复（有限次）→ 终态落盘 AgentRun 记录。
 * 校验失败的原始输出完整保留在 outputs 文件里——坏输出是复盘素材，
 * 只是不进结构化 UI。
 */
export class TaskRunner implements TaskRunnerPort {
  constructor(
    private readonly sessionFactory: TaskSessionFactoryPort<AgentSession>,
    private readonly runStore: AgentRunStore,
    private readonly toolCatalog: ToolCatalog
  ) {}

  async run(request: TaskRunRequest): Promise<TaskRunResult> {
    const runId = randomUUID();
    const createdAt = new Date().toISOString();
    const spec = resolveTaskSpec(request.persona, this.toolCatalog);
    const schemaId = request.persona.output;

    if (!schemaId) {
      throw new Error(`task persona 缺少输出 schema 声明：${request.persona.id}`);
    }

    const session = await this.sessionFactory.createTaskSession(spec, request.cwd);
    const onAbort = () => void Promise.resolve(session.abort()).catch(() => undefined);
    request.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      if (request.signal?.aborted) {
        return { status: 'cancelled', runId };
      }

      const outcome = await this.promptWithRepair(session, request, schemaId);
      if (request.signal?.aborted) {
        await this.record(runId, request, spec, createdAt, 'cancelled', session);
        return { status: 'cancelled', runId, usage: readUsage(session) };
      }

      const outputRef = await this.runStore.saveOutput(runId, outcome.rawText, request.cwd);

      if (outcome.ok) {
        await this.record(runId, request, spec, createdAt, 'success', session, outputRef);
        return { status: 'success', runId, output: outcome.value, outputRef, usage: readUsage(session) };
      }

      await this.record(runId, request, spec, createdAt, 'failed', session, outputRef);
      return { status: 'failed', runId, errors: outcome.errors, outputRef, usage: readUsage(session) };
    } finally {
      request.signal?.removeEventListener('abort', onAbort);
      session.dispose();
    }
  }

  /** 首轮执行 + 有限次修复重试；返回最终校验结果与最后一轮原始输出。 */
  private async promptWithRepair(
    session: AgentSession,
    request: TaskRunRequest,
    schemaId: string
  ): Promise<{ ok: true; value: unknown; rawText: string } | { ok: false; errors: string[]; rawText: string }> {
    let promptText =
      request.maxPromptTokens !== undefined
        ? renderTaskPromptWithinBudget(request.brief, request.text, request.contextPrompt, request.maxPromptTokens)
        : renderTaskPrompt(request.brief, request.text, request.contextPrompt);
    let rawText = '';
    let errors: string[] = [];

    for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
      await session.prompt(promptText);

      if (request.signal?.aborted) {
        return { ok: false, errors: ['已取消'], rawText };
      }

      rawText = session.getLastAssistantText() ?? '';
      const extracted = extractTaskOutput(rawText);

      if (extracted.ok) {
        const validated = validateOutput(schemaId, extracted.value);

        if (validated.ok) {
          return { ok: true, value: validated.value, rawText };
        }

        errors = validated.errors;
      } else {
        errors = [extracted.message];
      }

      // 修复轮：把校验错误原样反馈，让模型只重发修正后的 <output> 块。
      promptText = renderRepairPrompt(errors);
    }

    return { ok: false, errors, rawText };
  }

  private async record(
    runId: string,
    request: TaskRunRequest,
    spec: { personaId: string; systemPrompt: string },
    createdAt: string,
    status: AgentRunRecord['status'],
    session: AgentSession,
    outputRef?: string
  ): Promise<void> {
    const record: AgentRunRecord = {
      id: runId,
      personaId: spec.personaId,
      execution: 'task',
      trigger: request.trigger,
      ...(request.parentSessionId ? { parentSessionId: request.parentSessionId } : {}),
      promptTemplateHash: createHash('sha1').update(spec.systemPrompt).digest('hex'),
      inputDigest: { brief: request.brief },
      ...(outputRef ? { outputRef } : {}),
      memoryRefs: [],
      status,
      usage: readUsage(session),
      createdAt,
      completedAt: new Date().toISOString()
    };

    // 记录落盘失败不应吞掉任务结果本身。
    await this.runStore.append(record, request.cwd).catch(() => undefined);
  }
}

/** 从会话统计读取 token 消耗；落盘记录与返回值共用同一口径。 */
function readUsage(session: AgentSession): TaskRunUsage {
  const tokens = session.getSessionStats().tokens;
  return { inputTokens: tokens.input, outputTokens: tokens.output };
}

/** 转义嵌入 XML envelope 的文本，防止正文内容被误认为信封边界。 */
function escapeXmlText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** 渲染任务提示词：简报 + 可选附件信封 + 待处理正文，各自装入独立段落。 */
export function renderTaskPrompt(brief: string, text: string, contextPrompt?: string): string {
  return renderEscapedTaskPrompt(escapeXmlText(brief.trim()), escapeXmlText(text), contextPrompt);
}

/** 在 XML 转义后计算最终首轮 prompt，确保实体膨胀也不能突破模型预算。 */
export function renderTaskPromptWithinBudget(
  brief: string,
  text: string,
  contextPrompt: string | undefined,
  maxTokens: number
): string {
  const limit = Math.max(0, Math.floor(maxTokens));
  const escapedBrief = escapeXmlText(brief.trim());
  const escapedText = escapeXmlText(text);
  const fixed = renderEscapedTaskPrompt(escapedBrief, '', contextPrompt);
  const fixedTokens = estimateTextTokens(fixed);

  if (fixedTokens > limit) {
    throw new Error(`task prompt 固定内容超出预算：${fixedTokens}/${limit} tokens`);
  }

  let textBudget = limit - fixedTokens;
  let prompt = renderEscapedTaskPrompt(escapedBrief, fitTextToTokens(escapedText, textBudget), contextPrompt);

  while (estimateTextTokens(prompt) > limit && textBudget > 0) {
    textBudget = Math.max(0, textBudget - (estimateTextTokens(prompt) - limit));
    prompt = renderEscapedTaskPrompt(escapedBrief, fitTextToTokens(escapedText, textBudget), contextPrompt);
  }

  if (estimateTextTokens(prompt) > limit) {
    throw new Error(`task prompt 无法收敛到预算：${estimateTextTokens(prompt)}/${limit} tokens`);
  }

  return prompt;
}

function renderEscapedTaskPrompt(escapedBrief: string, escapedText: string, contextPrompt?: string): string {
  return [
    '<task_brief>',
    escapedBrief,
    '</task_brief>',
    // 附件信封由 ContextFileService 生成，已是规范 XML，不再转义。
    ...(contextPrompt ? ['', contextPrompt.trim()] : []),
    '',
    '<task_input>',
    escapedText,
    '</task_input>'
  ].join('\n');
}

/** 渲染修复提示词：携带校验错误，只要求重发修正后的输出块。 */
function renderRepairPrompt(errors: string[]): string {
  return [
    '你上一次的 <output> 输出未通过校验，错误如下：',
    ...errors.map(error => `- ${error}`),
    '',
    '请重新输出完整且符合 schema 的 <output>…</output> 块（内容为 JSON），不要输出其他解释。'
  ].join('\n');
}
