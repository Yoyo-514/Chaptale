import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SessionProcessInput } from './fixtures/session-process.ts';

interface ProcessResult {
  id: string;
  file: string;
  cwd: string;
  restoredMessages: { role: string; content: unknown }[];
  messages: { role: string; content: unknown }[];
}

let root: string;
let input: SessionProcessInput;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chaptale-session-storage-'));
  input = {
    cwd: join(root, '作品 空间'),
    agentDir: join(root, 'agent'),
    sessionDir: join(root, '会话 存储')
  };
  for (const directory of [input.cwd, input.agentDir, input.sessionDir]) await mkdir(directory);
});

afterEach(async () => {
  // 只清理由本测试创建的临时目录，不删除调用方传入的路径。
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('chaptale-session-storage-')) {
    throw new Error('拒绝清理测试临时目录以外的路径');
  }
  await rm(root, { recursive: true, force: true });
});

async function run(overrides: Partial<SessionProcessInput> = {}): Promise<ProcessResult> {
  const options = { ...input, ...overrides };
  const fixture = fileURLToPath(new URL('./fixtures/session-process.ts', import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, [fixture, JSON.stringify(options)], {
    cwd: options.cwd,
    timeout: 15_000,
    windowsHide: true
  });
  return JSON.parse(stdout);
}

function userMessages(contents: string[]) {
  return contents.map(content => ({ role: 'user', content }));
}

describe('宿主 JSONL 持久化', () => {
  it('空会话自然退出后不创建文件', async () => {
    const result = await run();

    expect(dirname(result.file)).toBe(input.sessionDir);
    expect(result.messages).toEqual([]);
    expect(await readdir(input.sessionDir)).toEqual([]);
    expect(await readdir(input.agentDir)).toEqual([]);
  }, 20_000);

  it('跨进程恢复身份与历史，续写不覆盖旧记录', async () => {
    const first = await run({ messages: ['第一章：雨夜', '角色记得那封信。'] });
    const original = await readFile(first.file, 'utf8');
    const second = await run({ file: first.file, messages: ['第二章：天亮'] });
    const third = await run({ file: first.file });

    expect(third.id).toBe(first.id);
    expect(third.cwd).toBe(input.cwd);
    expect(third.file).toBe(first.file);
    expect(second.restoredMessages).toMatchObject(userMessages(['第一章：雨夜', '角色记得那封信。']));
    expect(third.restoredMessages).toMatchObject(userMessages(['第一章：雨夜', '角色记得那封信。', '第二章：天亮']));
    expect((await readFile(first.file, 'utf8')).startsWith(original)).toBe(true);
    expect(await readdir(input.sessionDir)).toEqual([basename(first.file)]);
    expect(await readdir(input.agentDir)).toEqual([]);
  }, 50_000);

  it('同目录下的独立会话不串历史', async () => {
    const first = await run({ messages: ['作品甲'] });
    const second = await run({ messages: ['作品乙'] });
    const reopened = await run({ file: first.file });

    expect(second.id).not.toBe(first.id);
    expect(second.file).not.toBe(first.file);
    expect(reopened.restoredMessages).toMatchObject(userMessages(['作品甲']));
    expect(second.messages).toMatchObject(userMessages(['作品乙']));
    expect(await readdir(input.sessionDir)).toHaveLength(2);
  }, 50_000);
});
