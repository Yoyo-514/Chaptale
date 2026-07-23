import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { builtinCompanionBody } from '../../personas/builtin';
import { PromptFileService } from '../file-service';

describe('PromptFileService', () => {
  let agentDir: string;

  beforeEach(async () => {
    agentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-prompt-files-'));
  });

  afterEach(async () => {
    await fs.rm(agentDir, { recursive: true, force: true });
  });

  it('exposes the built-in prompt without creating files when pi prompt files are absent', async () => {
    const service = new PromptFileService(agentDir);

    await expect(service.getState()).resolves.toEqual({
      systemPrompt: builtinCompanionBody,
      appendSystemPrompt: '',
      defaultSystemPrompt: builtinCompanionBody,
      systemPromptPath: path.join(agentDir, 'SYSTEM.md'),
      appendSystemPromptPath: path.join(agentDir, 'APPEND_SYSTEM.md')
    });
    await expect(fs.readdir(agentDir)).resolves.toEqual([]);
  });

  it('loads user-created prompt files before falling back to defaults', async () => {
    await fs.writeFile(path.join(agentDir, 'SYSTEM.md'), '用户放入的系统提示', 'utf8');
    await fs.writeFile(path.join(agentDir, 'APPEND_SYSTEM.md'), '用户放入的追加提示', 'utf8');
    const service = new PromptFileService(agentDir);

    await expect(service.getState()).resolves.toMatchObject({
      systemPrompt: '用户放入的系统提示',
      appendSystemPrompt: '用户放入的追加提示'
    });
  });

  it('uses the built-in prompt when an externally edited SYSTEM.md is blank', async () => {
    await fs.writeFile(path.join(agentDir, 'SYSTEM.md'), ' \n', 'utf8');
    const service = new PromptFileService(agentDir);

    await expect(service.getState()).resolves.toMatchObject({ systemPrompt: builtinCompanionBody });
  });

  it('writes and reads pi-native prompt files without changing their content', async () => {
    const service = new PromptFileService(agentDir);
    const payload = {
      systemPrompt: '自定义系统提示\n保留原始换行',
      appendSystemPrompt: '追加提示\n'
    };

    const state = await service.update(payload);

    expect(state).toMatchObject(payload);
    await expect(fs.readFile(service.systemPromptPath, 'utf8')).resolves.toBe(payload.systemPrompt);
    await expect(fs.readFile(service.appendSystemPromptPath, 'utf8')).resolves.toBe(payload.appendSystemPrompt);
  });

  it('does not create APPEND_SYSTEM.md when the append prompt is empty', async () => {
    const service = new PromptFileService(agentDir);

    await expect(service.update({ systemPrompt: '有效提示', appendSystemPrompt: ' \n' })).resolves.toMatchObject({
      systemPrompt: '有效提示',
      appendSystemPrompt: ''
    });
    await expect(fs.access(service.appendSystemPromptPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps a user-created APPEND_SYSTEM.md when its content is cleared', async () => {
    const service = new PromptFileService(agentDir);
    await fs.writeFile(service.appendSystemPromptPath, '用户追加提示', 'utf8');

    await service.update({ systemPrompt: '有效提示', appendSystemPrompt: '' });

    await expect(fs.readFile(service.appendSystemPromptPath, 'utf8')).resolves.toBe('');
  });

  it('rejects blank or malformed system prompt updates', async () => {
    const service = new PromptFileService(agentDir);

    await expect(service.update({ systemPrompt: ' \n', appendSystemPrompt: '' })).rejects.toThrow(
      'System Prompt 不能为空'
    );
    const malformedPayload = { systemPrompt: '有效提示' } as unknown as Parameters<PromptFileService['update']>[0];
    await expect(service.update(malformedPayload)).rejects.toThrow('Prompt 设置格式无效');
  });
});
