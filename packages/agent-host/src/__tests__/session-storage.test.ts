import { CURRENT_SESSION_VERSION, SessionManager } from '@earendil-works/pi-coding-agent';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openHostSessionManager } from '../index.ts';

let root: string;
let cwd: string;
let sessionDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chaptale-session-open-'));
  cwd = join(root, '作品');
  sessionDir = join(root, 'sessions');
  await mkdir(cwd);
  await mkdir(sessionDir);
});

afterEach(async () => {
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('chaptale-session-open-')) {
    throw new Error('拒绝清理测试目录以外的路径');
  }
  await rm(root, { recursive: true, force: true });
});

function createHistory() {
  const manager = SessionManager.create(cwd, sessionDir);
  manager.appendMessage({ role: 'user', content: '保留的历史', timestamp: 1 });
  return manager;
}

function mutateEntry(text: string, index: number, patch: Record<string, unknown>): string {
  const lines = text.trimEnd().split('\n');
  lines[index] = JSON.stringify({ ...JSON.parse(lines[index]!), ...patch });
  return lines.join('\n') + '\n';
}

describe('严格会话打开', () => {
  it('打开原生历史并续写，不创建另一会话或覆盖消息', async () => {
    const original = createHistory();
    const file = original.getSessionFile()!;
    const before = await readFile(file);

    const manager = await openHostSessionManager({ file, cwd });

    expect(manager.getSessionId()).toBe(original.getSessionId());
    expect(await readFile(file)).toEqual(before);
    manager.appendMessage({ role: 'user', content: '新增的消息', timestamp: 2 });
    expect(manager.buildSessionContext().messages).toMatchObject([
      { role: 'user', content: '保留的历史' },
      { role: 'user', content: '新增的消息' }
    ]);
  });

  it('接受 CRLF 与空行，不改写有效历史', async () => {
    const file = createHistory().getSessionFile()!;
    await writeFile(file, (await readFile(file, 'utf8')).replace(/\n/g, '\r\n') + '\r\n');
    const before = await readFile(file);

    const manager = await openHostSessionManager({ file, cwd });

    expect(manager.buildSessionContext().messages).toHaveLength(1);
    expect(await readFile(file)).toEqual(before);
  });

  it('保留只有合法文件头的空会话身份', async () => {
    const original = createHistory();
    const file = original.getSessionFile()!;
    await writeFile(file, (await readFile(file, 'utf8')).split('\n')[0] + '\n');
    const before = await readFile(file);

    const manager = await openHostSessionManager({ file, cwd });

    expect(manager.getSessionId()).toBe(original.getSessionId());
    expect(manager.buildSessionContext().messages).toEqual([]);
    expect(await readFile(file)).toEqual(before);
  });

  it('缺失历史时明确拒绝，不准备新会话', async () => {
    const file = join(sessionDir, 'missing.jsonl');

    await expect(openHostSessionManager({ file, cwd })).rejects.toMatchObject({ code: 'not-found' });
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    { name: '空文件', change: (_text: string) => '' },
    { name: '只有空白', change: (_text: string) => ' \n\n' },
    { name: '损坏尾行', change: (text: string) => text + '{"private":"not-for-errors"\n' },
    { name: '缺少末尾换行', change: (text: string) => text.trimEnd() },
    { name: '非对象条目', change: (text: string) => text + 'null\n' },
    { name: '重复条目 ID', change: (text: string) => text + text.trimEnd().split('\n').at(-1) + '\n' },
    { name: '断开的父条目', change: (text: string) => mutateEntry(text, 1, { parentId: 'missing-parent' }) },
    { name: '无效消息', change: (text: string) => mutateEntry(text, 1, { message: null }) }
  ])('拒绝 $name 并完整保留原文件', async ({ change }) => {
    const file = createHistory().getSessionFile()!;
    await writeFile(file, change(await readFile(file, 'utf8')));
    const before = await readFile(file);

    await expect(openHostSessionManager({ file, cwd })).rejects.toMatchObject({ code: 'recovery-required' });
    expect(await readFile(file)).toEqual(before);
  });

  it.each([CURRENT_SESSION_VERSION - 1, CURRENT_SESSION_VERSION + 1])('拒绝自动迁移版本 %s', async version => {
    const file = createHistory().getSessionFile()!;
    await writeFile(file, mutateEntry(await readFile(file, 'utf8'), 0, { version }));
    const before = await readFile(file);

    await expect(openHostSessionManager({ file, cwd })).rejects.toMatchObject({ code: 'unsupported-version' });
    expect(await readFile(file)).toEqual(before);
  });

  it('工作目录不一致时不打开或修复文件', async () => {
    const file = createHistory().getSessionFile()!;
    const before = await readFile(file);

    await expect(openHostSessionManager({ file, cwd: root })).rejects.toMatchObject({ code: 'cwd-mismatch' });
    expect(await readFile(file)).toEqual(before);
  });

  it.each(['relative.jsonl', 'directory'])('拒绝无效文件路径 %s', async value => {
    const file = value === 'directory' ? sessionDir : value;
    await expect(openHostSessionManager({ file, cwd })).rejects.toMatchObject({ code: 'invalid-path' });
  });

  it('拒绝无效 UTF-8，不将替换字符当作历史内容', async () => {
    const file = createHistory().getSessionFile()!;
    const text = await readFile(file, 'utf8');
    const damaged = Buffer.from(text);
    damaged[damaged.indexOf(Buffer.from('保留的历史'))] = 0xff;
    await writeFile(file, damaged);

    await expect(openHostSessionManager({ file, cwd })).rejects.toMatchObject({ code: 'recovery-required' });
    expect(await readFile(file)).toEqual(damaged);
  });
});
