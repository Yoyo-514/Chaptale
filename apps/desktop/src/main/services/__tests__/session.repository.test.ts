import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JsonlSessionRepository } from '../session.repository';

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-session-repo-'));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe('JsonlSessionRepository', () => {
  it('creates pi-like v3 jsonl session files', async () => {
    const repository = new JsonlSessionRepository({ rootDir, cwd: rootDir });

    const session = await repository.create({ name: '测试会话' });
    const content = await readFile(session.path, 'utf8');
    const [headerLine, infoLine] = content.trim().split('\n');

    expect(JSON.parse(headerLine)).toMatchObject({
      type: 'session',
      version: 3,
      id: session.id,
      cwd: rootDir
    });
    expect(JSON.parse(infoLine)).toMatchObject({
      type: 'session_info',
      name: '测试会话'
    });
  });

  it('appends messages as a parent-linked path to the current leaf', async () => {
    const repository = new JsonlSessionRepository({ rootDir, cwd: rootDir });
    const session = await repository.create();

    const first = await repository.appendMessage(session.id, {
      type: 'user',
      payload: { content: '你好' }
    });
    const second = await repository.appendMessage(session.id, {
      type: 'assistant',
      payload: { content: '你好喵' }
    });

    expect(second.parentId).toBe(first.id);
    await expect(repository.getMessages(session.id)).resolves.toEqual([
      {
        type: 'user',
        payload: { content: '你好' }
      },
      {
        type: 'assistant',
        payload: { content: '你好喵' }
      }
    ]);
  });

  it('deletes the underlying jsonl session file', async () => {
    const repository = new JsonlSessionRepository({ rootDir, cwd: rootDir });
    const session = await repository.create({ name: '待删除会话' });

    await expect(access(session.path)).resolves.toBeUndefined();

    await repository.delete(session.id);

    await expect(access(session.path)).rejects.toThrow();
  });

  it('supports leaf switching for branch-style history reads', async () => {
    const repository = new JsonlSessionRepository({ rootDir, cwd: rootDir });
    const session = await repository.create();

    const root = await repository.appendMessage(session.id, {
      type: 'user',
      payload: { content: '起点' }
    });
    await repository.appendMessage(session.id, {
      type: 'assistant',
      payload: { content: '原分支' }
    });
    await repository.setLeafId(session.id, root.id);
    await repository.appendMessage(session.id, {
      type: 'assistant',
      payload: { content: '新分支' }
    });

    await expect(repository.getMessages(session.id)).resolves.toEqual([
      {
        type: 'user',
        payload: { content: '起点' }
      },
      {
        type: 'assistant',
        payload: { content: '新分支' }
      }
    ]);
  });
});
