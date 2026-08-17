import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JsonlSessionRepository } from '../repository';

const MEMORY = '<memory>\n林晚左臂为义肢\n</memory>\n\n';
const CONTEXT =
  '<attached_context_files>\n<file path="设定/人物.md" kind="text" size="1 KB" />\n</attached_context_files>\n\n';

let dir: string;
let repository: JsonlSessionRepository;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-session-decode-'));
  repository = new JsonlSessionRepository({
    rootDir: dir,
    cwd: '/workspace',
    sessionDir: path.join(dir, 'sessions', 'global'),
    sessionsRootDir: path.join(dir, 'sessions')
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('历史回放剥离注入信封', () => {
  it('用户消息只回放作者原文，不泄漏记忆与附件信封', async () => {
    // 回归：读回路径直接返回落盘原文，历史里每条用户消息都带着整块 <memory> 显示。
    const store = await repository.openOrCreate('s1');
    await store.appendMessage({ role: 'user', content: `${MEMORY}${CONTEXT}看下人物设定` });

    const [message] = await repository.getMessages('s1');

    expect(message).toMatchObject({ role: 'user', content: '看下人物设定' });
  });

  it('落盘缺元数据时用信封恢复 contextFiles', async () => {
    const store = await repository.openOrCreate('s1');
    await store.appendMessage({ role: 'user', content: `${CONTEXT}继续` });

    const [message] = await repository.getMessages('s1');

    expect(message).toMatchObject({
      content: '继续',
      contextFiles: [expect.objectContaining({ path: '设定/人物.md' })]
    });
  });

  it('随行 contextFiles 元数据优先于信封解析结果', async () => {
    const store = await repository.openOrCreate('s1');
    await store.appendMessage({
      role: 'user',
      content: `${CONTEXT}继续`,
      contextFiles: [{ path: '权威/来源.md', name: '来源.md', size: 1, kind: 'text' }]
    });

    const [message] = await repository.getMessages('s1');

    expect(message).toMatchObject({ contextFiles: [expect.objectContaining({ path: '权威/来源.md' })] });
  });

  it('恢复 skill 调用标记', async () => {
    const store = await repository.openOrCreate('s1');
    await store.appendMessage({ role: 'user', content: `/skill:review ${MEMORY}检查第一章` });

    const [message] = await repository.getMessages('s1');

    expect(message).toMatchObject({
      content: '检查第一章',
      skillInvocation: { name: 'review', arguments: '检查第一章' }
    });
  });

  it('多模态消息只剥首个文本块的信封', async () => {
    const store = await repository.openOrCreate('s1');
    await store.appendMessage({
      role: 'user',
      content: [
        { type: 'text', text: `${MEMORY}看这张图` },
        { type: 'image', mimeType: 'image/png', data: 'YWJj' }
      ]
    });

    const [message] = await repository.getMessages('s1');
    const texts =
      message && message.role === 'user' && Array.isArray(message.content)
        ? message.content.filter(part => part.type === 'text')
        : [];

    expect(texts).toEqual([{ type: 'text', text: '看这张图' }]);
  });
});
