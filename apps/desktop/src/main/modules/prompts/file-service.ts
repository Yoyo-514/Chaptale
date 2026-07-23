import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { PromptSettingsState, UpdatePromptSettingsPayload } from '@chaptale/ipc-contract';

import { readOptionalTextFile } from '../../infra/filesystem/files';
import { builtinCompanionBody } from '../personas/builtin';

const SYSTEM_PROMPT_FILE = 'SYSTEM.md';
const APPEND_SYSTEM_PROMPT_FILE = 'APPEND_SYSTEM.md';

async function writeOptionalPromptFile(filePath: string, content: string) {
  if (content.trim()) {
    await fs.writeFile(filePath, content, 'utf8');
    return;
  }

  try {
    // 文件由用户创建时保留文件本身；仅清空内容，缺失时则不生成新的空文件。
    await fs.truncate(filePath, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

function validatePayload(payload: UpdatePromptSettingsPayload) {
  if (!payload || typeof payload.systemPrompt !== 'string' || typeof payload.appendSystemPrompt !== 'string') {
    throw new Error('Prompt 设置格式无效');
  }

  if (!payload.systemPrompt.trim()) {
    throw new Error('System Prompt 不能为空');
  }
}

/** 管理 SYSTEM.md / APPEND_SYSTEM.md 的项目配置边界，不参与最终提示词拼装。 */
export class PromptFileService {
  readonly systemPromptPath: string;
  readonly appendSystemPromptPath: string;
  private writeQueue = Promise.resolve();

  constructor(private readonly agentDir: string) {
    this.systemPromptPath = path.join(agentDir, SYSTEM_PROMPT_FILE);
    this.appendSystemPromptPath = path.join(agentDir, APPEND_SYSTEM_PROMPT_FILE);
  }

  async getState(): Promise<PromptSettingsState> {
    const [systemPrompt, appendSystemPrompt] = await Promise.all([
      readOptionalTextFile(this.systemPromptPath),
      readOptionalTextFile(this.appendSystemPromptPath)
    ]);

    return {
      // 设置 UI 展示的"当前生效值"：SYSTEM.md 缺失时回退内置 companion 正文。
      systemPrompt: systemPrompt?.trim() ? systemPrompt : builtinCompanionBody,
      appendSystemPrompt: appendSystemPrompt ?? '',
      defaultSystemPrompt: builtinCompanionBody,
      systemPromptPath: this.systemPromptPath,
      appendSystemPromptPath: this.appendSystemPromptPath
    };
  }

  update(payload: UpdatePromptSettingsPayload): Promise<PromptSettingsState> {
    return this.enqueue(async () => {
      validatePayload(payload);
      await fs.mkdir(this.agentDir, { recursive: true });
      await fs.writeFile(this.systemPromptPath, payload.systemPrompt, 'utf8');
      await writeOptionalPromptFile(this.appendSystemPromptPath, payload.appendSystemPrompt);
      return this.getState();
    });
  }

  /** 串行化同一组 Prompt 文件的写入；前一次失败也必须释放队列，允许后续保存继续执行。 */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}
