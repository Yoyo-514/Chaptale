import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
  entries: { id: string; parentId: string | null; message: { role: string; content: unknown } }[];
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

describe('原生 JSONL 持久化', () => {
  it('空会话自然退出后不创建文件', async () => {
    const result = await run();

    expect(dirname(result.file)).toBe(input.sessionDir);
    expect(result.messages).toEqual([]);
    await expect(readFile(result.file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(input.sessionDir)).toEqual([]);
    expect(await readdir(input.agentDir)).toEqual([]);
  }, 20_000);

  it('跨进程恢复身份与历史，续写不覆盖旧记录', async () => {
    const first = await run({ messages: ['第一章：雨夜', '角色记得那封信。'] });
    const original = await readFile(first.file, 'utf8');
    const second = await run({ file: first.file, messages: ['第二章：天亮'] });
    const third = await run({ file: first.file });

    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(third.cwd).toBe(input.cwd);
    expect(third.file).toBe(first.file);
    expect(second.restoredMessages).toMatchObject(userMessages(['第一章：雨夜', '角色记得那封信。']));
    expect(third.restoredMessages).toMatchObject(userMessages(['第一章：雨夜', '角色记得那封信。', '第二章：天亮']));
    expect(third.entries.slice(0, 2)).toEqual(first.entries);
    expect(third.entries[2]!.parentId).toBe(first.entries[1]!.id);
    expect(new Set(third.entries.map(entry => entry.id)).size).toBe(3);
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

  it('SDK 打开不存在的路径会准备新会话，而不是报告丢失', async () => {
    const file = join(input.sessionDir, 'missing.jsonl');
    const empty = await run({ file });
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
    const written = await run({ file, messages: ['这是一条新历史'] });
    const reopened = await run({ file });

    expect(empty.file).toBe(file);
    expect(empty.messages).toEqual([]);
    expect(written.id).not.toBe(empty.id);
    expect(reopened.id).toBe(written.id);
    expect(reopened.restoredMessages).toMatchObject(userMessages(['这是一条新历史']));
  }, 50_000);

  it('拒绝完全损坏的非空文件且不覆盖原内容', async () => {
    const file = join(input.sessionDir, 'invalid.jsonl');
    const original = '不是有效的 JSONL\n';
    await writeFile(file, original);

    await expect(run({ file })).rejects.toThrow('not a valid');
    expect(await readFile(file, 'utf8')).toBe(original);
  }, 20_000);

  it.each(['\n', ''])(
    '跳过损坏尾行并可继续追加，尾行换行=%j',
    async newline => {
      const first = await run({ messages: ['已保存的输入'] });
      const original = await readFile(first.file, 'utf8');
      const damaged = `${original}{"type":"message","id":"partial"${newline}`;
      await writeFile(first.file, damaged);
      const second = await run({ file: first.file, messages: ['恢复后追加'] });
      const third = await run({ file: first.file });

      expect(second.id).toBe(first.id);
      expect(second.restoredMessages).toMatchObject(userMessages(['已保存的输入']));
      expect(third.restoredMessages).toMatchObject(userMessages(['已保存的输入', '恢复后追加']));
      expect(third.entries[1]!.parentId).toBe(first.entries[0]!.id);
      expect((await readFile(first.file, 'utf8')).startsWith(damaged)).toBe(true);
    },
    50_000
  );

  it('重开其他工作目录的会话时宿主拒绝且不修改文件', async () => {
    const first = await run({ messages: ['原作品'] });
    const original = await readFile(first.file, 'utf8');
    const otherCwd = join(root, '另一作品');
    await mkdir(otherCwd);

    await expect(run({ file: first.file, cwd: otherCwd })).rejects.toThrow('工作目录不一致');
    expect(await readFile(first.file, 'utf8')).toBe(original);
  }, 35_000);
});
