import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PiSessionRepository } from '../session.repository';

let rootDir: string;
let sessionDir: string;

function createRepository() {
  return new PiSessionRepository({
    rootDir,
    cwd: rootDir,
    sessionDir
  });
}

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-pi-session-repo-'));
  sessionDir = path.join(rootDir, 'sessions', 'global');
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe('PiSessionRepository', () => {
  it('creates pi v3 jsonl session files through SessionManager', async () => {
    const repository = createRepository();

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

  it('lists pi sessions from the configured session directory', async () => {
    const repository = createRepository();

    const session = await repository.create({ name: '列表会话' });
    await repository.appendMessage(session.id, {
      type: 'user',
      payload: { content: '你好' }
    });

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({
        id: session.id,
        name: '列表会话',
        messageCount: 1,
        scope: 'global',
        totalTokens: 0,
        totalCost: 0
      })
    ]);
  });

  it('maps Chaptale messages to pi messages and reads the active branch', async () => {
    const repository = createRepository();
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

  it('deletes the underlying pi jsonl session file', async () => {
    const repository = createRepository();
    const session = await repository.create({ name: '待删除会话' });

    await expect(access(session.path)).resolves.toBeUndefined();

    await repository.delete(session.id);

    await expect(access(session.path)).rejects.toThrow();
  });

  it('deletes multiple session files in one repository operation', async () => {
    const repository = createRepository();
    const first = await repository.create({ name: '批量删除 1' });
    const second = await repository.create({ name: '批量删除 2' });

    await repository.deleteMany([first.id, second.id]);

    await expect(access(first.path)).rejects.toThrow();
    await expect(access(second.path)).rejects.toThrow();
  });
});
