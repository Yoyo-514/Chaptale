import { SessionManager } from '@earendil-works/pi-coding-agent';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { setupHost, app, options, model, entry, builtin, open, view, history } from './host-fixture.ts';

setupHost();

it('缺少指令或模式记录的历史只读打开，不套用当前默认值，原件保持不变', async () => {
  const cases = [
    history(['没有任何记录'], {}),
    history(['只有指令'], { entries: builtin }),
    history(['只有模式'], { mode: 'review' })
  ];
  for (const input of cases) {
    const original = await readFile(input.file, 'utf8');
    const id = await open(input);
    expect(view(id)).toMatchObject({
      file: input.file,
      instructions: [],
      readonly: { reason: 'incomplete', lines: [] },
      messages: [{ role: 'user' }]
    });
    expect(view(id).mode).toBeUndefined();
    expect(await readFile(input.file, 'utf8')).toBe(original);
  }
});

it('旧格式提示词记录不被识别为指令，历史只读打开', async () => {
  const manager = SessionManager.create(options.cwd, join(options.sessionDir, 'unassigned'));
  manager.appendCustomEntry('chaptale-system-prompt', { text: '旧提示词' });
  manager.appendMessage({ role: 'user', content: '旧历史', timestamp: Date.now() });
  const id = await open({ file: manager.getSessionFile()! });
  expect(view(id).readonly?.reason).toBe('incomplete');
});

it('只读历史拒绝继续、压缩、修改指令、模式和模型，可以关闭', async () => {
  const id = await open(history(['只读'], {}));
  const rejected = '该会话为只读历史';
  await expect(app.execute({ method: 'prompt', input: { id, text: '继续' } })).rejects.toThrow(rejected);
  await expect(app.execute({ method: 'instructions', input: { id, entries: builtin } })).rejects.toThrow(rejected);
  await expect(app.execute({ method: 'mode', input: { id, mode: 'direct' } })).rejects.toThrow(rejected);
  await expect(app.execute({ method: 'model', input: { id, model } })).rejects.toThrow(rejected);
  await expect(app.execute({ method: 'cancel', input: { id } })).rejects.toThrow(rejected);
  await expect(app.execute({ method: 'compact', input: { id } })).rejects.toThrow(rejected);
  expect(app.liveSession(id)).toBeUndefined();
  await app.execute({ method: 'close', input: { id } });
  expect(app.snapshot().sessions).toEqual([]);
});

it('损坏的 JSONL 只读打开，标出坏行位置并显示可解析的消息，原件保持不变', async () => {
  const input = history(['第一段', '第二段']);
  const lines = (await readFile(input.file, 'utf8')).split('\n');
  // 第 4 行插入坏行，最后追加未写完的行。
  lines.splice(3, 0, '{坏行');
  const damaged = `${lines.join('\n')}{"type":"message"`;
  await writeFile(input.file, damaged, 'utf8');
  const id = await open(input);
  expect(view(id)).toMatchObject({
    instructions: [],
    readonly: { reason: 'damaged', lines: [4, lines.length] },
    messages: [{ text: '第一段' }, { text: '第二段' }]
  });
  expect(await readFile(input.file, 'utf8')).toBe(damaged);
});

it('无效的指令记录按损坏历史只读打开', async () => {
  const id = await open(history(['记录无效'], { entries: [entry('空', 'system', ' ')], mode: 'review' }));
  expect(view(id).readonly).toMatchObject({ reason: 'damaged', lines: [] });
  expect(view(id).messages).toMatchObject([{ text: '记录无效' }]);
});
