import type { PromptSettingsState, UpdatePromptSettingsPayload } from '@chaptale/ipc-contract';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readOptionalTextFile } from '../../infra/filesystem/files';
import { DEFAULT_SYSTEM_PROMPT } from './default-system-prompt';
import { resolveSystemPrompt } from './resolve-system-prompt';

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
      systemPrompt: resolveSystemPrompt(systemPrompt),
      appendSystemPrompt: appendSystemPrompt ?? '',
      defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
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

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}
