import { SessionManager } from '@earendil-works/pi-coding-agent';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { type AgentInstructions, type EditMode } from '../../protocol/index.ts';
import { createHostApplication, HostApplication } from '../index.ts';
import {
  setupHost,
  root,
  app,
  options,
  captured,
  model,
  capture,
  entry,
  builtin,
  create,
  open,
  view,
  settled,
  history,
  restart
} from './host-fixture.ts';

setupHost();

it('全局默认指令只影响之后创建的会话并写入设置文件，会话指令互不串用', async () => {
  const first = await create();
  const defaults = [entry('新默认', 'system', '新的默认指令')];
  await app.execute({ method: 'defaultInstructions', input: { entries: defaults } });
  const second = await create();
  const own = [entry('独立', 'system', '第一位独立指令')];
  await app.execute({ method: 'instructions', input: { id: first, entries: own } });
  expect(view(first).instructions).toEqual(own);
  expect(view(second).instructions).toEqual(defaults);
  expect(app.snapshot().settings.defaultInstructions).toEqual(defaults);
  expect(JSON.parse(await readFile(options.settingsFile, 'utf8'))).toMatchObject({ defaultInstructions: defaults });
});

it('设置写入失败时不更新内存设置或已有会话', async () => {
  const id = await create();
  // 临时文件位置被目录占用，之后的设置写入都会失败。
  await mkdir(`${options.settingsFile}.tmp`);
  await expect(
    app.execute({ method: 'defaultInstructions', input: { entries: [entry('不能保存', 'system', '内容')] } })
  ).rejects.toThrow();
  expect(app.snapshot().settings.defaultInstructions).toEqual(builtin);
  expect(view(id).instructions).toEqual(builtin);
});

it('设置文件损坏时拒绝装配且不改写原文件', async () => {
  await writeFile(options.settingsFile, '{坏的设置', 'utf8');
  await expect(HostApplication.create(options)).rejects.toThrow('应用设置文件损坏');
  expect(await readFile(options.settingsFile, 'utf8')).toBe('{坏的设置');
});

it('指令至少需要一个启用的 system 条目', async () => {
  const id = await create();
  await expect(
    app.execute({
      method: 'instructions',
      input: { id, entries: [entry('关闭', 'system', '停用', false), entry('开场', 'user', '你好')] }
    })
  ).rejects.toThrow('至少需要一个启用的 system 条目');
  expect(view(id).instructions).toEqual(builtin);
});

it('命名指令可保存、选用和删除，修改命名指令不影响已有会话', async () => {
  const named = [entry('悬疑', 'system', '悬疑写作指令'), entry('开场', 'user', '先读大纲')];
  await app.execute({ method: 'namedInstructions', input: { name: '悬疑', entries: named } });
  const id = await create('悬疑');
  expect(view(id).instructions).toEqual(named);

  await app.execute({ method: 'namedInstructions', input: { name: '悬疑', entries: builtin } });
  expect(app.snapshot().settings.namedInstructions).toEqual([{ name: '悬疑', entries: builtin }]);
  expect(view(id).instructions).toEqual(named);

  await app.execute({ method: 'deleteNamedInstructions', input: { name: '悬疑' } });
  expect(app.snapshot().settings.namedInstructions).toEqual([]);
  await expect(create('悬疑')).rejects.toThrow('命名指令不存在');
  await expect(app.execute({ method: 'deleteNamedInstructions', input: { name: '悬疑' } })).rejects.toThrow(
    '命名指令不存在'
  );
});

it('新会话使用全局默认模式，会话模式随历史重开且不跟随设置', async () => {
  const first = await create(undefined, capture);
  expect(view(first).mode).toBe('review');
  await app.execute({ method: 'defaultMode', input: { mode: 'direct' } });
  const second = await create();
  expect(view(second).mode).toBe('direct');

  await app.execute({ method: 'mode', input: { id: first, mode: 'discuss' } });
  await app.execute({ method: 'prompt', input: { id: first, text: '写入文件' } });
  await settled();
  const file = view(first).file;
  await restart();
  expect(app.snapshot().settings.defaultMode).toBe('direct');
  const reopened = await open({ file });
  expect(view(reopened).mode).toBe('discuss');
  await expect(app.execute({ method: 'mode', input: { id: reopened, mode: 'auto' as EditMode } })).rejects.toThrow(
    '修改模式无效'
  );
});

it('记录作者最近一次选择的模型，重启后保留', async () => {
  expect(app.snapshot().settings.lastModel).toBeNull();
  const id = await create();
  expect(app.snapshot().settings.lastModel).toEqual(model);
  await app.execute({ method: 'model', input: { id, model: capture } });
  expect(app.snapshot().settings.lastModel).toEqual(capture);
  await restart();
  expect(app.snapshot().settings.lastModel).toEqual(capture);
});

it('修改后的会话指令随原生历史重开，不跟随应用默认值', async () => {
  const input = history();
  const id = await open(input);
  const updated = [entry('更新', 'system', '更新后的会话指令')];
  await app.execute({ method: 'instructions', input: { id, entries: updated } });
  await app.execute({ method: 'close', input: { id } });
  await restart({ builtinInstructions: [entry('另一份', 'system', '另一份内置指令')] });
  const reopened = await open(input);
  expect(view(reopened).instructions).toEqual(updated);
  expect(view(reopened).messages[0].text).toBe('历史输入');
});

it('user/assistant 指令按顺序放在请求最前面，只用于请求，不写入会话消息', async () => {
  const entries: AgentInstructions = [
    entry('主创', 'system', '系统指令'),
    entry('开场', 'user', '先读大纲'),
    entry('停用', 'user', '停用的条目', false),
    entry('回应', 'assistant', '好的，已读大纲')
  ];
  await app.execute({ method: 'namedInstructions', input: { name: '前缀', entries } });
  const id = await create('前缀', capture);
  const done = settled();
  await app.execute({ method: 'prompt', input: { id, text: '写第一章' } });
  await done;

  const conversation = captured[0].filter(message => message.role !== 'system');
  expect(captured[0][0]).toMatchObject({ role: 'system' });
  expect(JSON.stringify(captured[0][0])).toContain('系统指令');
  expect(conversation.map(message => [message.role, JSON.stringify(message.content)])).toEqual([
    ['user', JSON.stringify('先读大纲')],
    ['assistant', JSON.stringify([{ type: 'text', text: '好的，已读大纲' }])],
    ['user', JSON.stringify([{ type: 'text', text: '写第一章' }])]
  ]);
  expect(view(id).messages.map(message => message.text)).not.toContain('先读大纲');
  const reopened = SessionManager.open(view(id).file).buildSessionContext().messages;
  // pi 会把系统提示词记入历史；对话前缀不应出现在历史里。
  expect(reopened.filter(message => message.role !== 'system').map(message => message.role)).toEqual([
    'user',
    'assistant'
  ]);
});

it('重载期间再次修改指令，在下一次发送生效而不是被丢弃', async () => {
  const id = await create(undefined, capture);
  const session = app.liveSession(id)!;
  const reload = session.reload.bind(session);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  session.reload = async () => {
    session.reload = reload;
    await gate;
    return reload();
  };

  await app.execute({ method: 'instructions', input: { id, entries: [entry('一', 'system', '第一次修改')] } });
  const first = settled();
  await app.execute({ method: 'prompt', input: { id, text: '第一次发送' } });
  await app.execute({ method: 'instructions', input: { id, entries: [entry('二', 'system', '重载期间再次修改')] } });
  release();
  await first;
  expect(session.systemPrompt).toContain('第一次修改');

  const second = settled();
  await app.execute({ method: 'prompt', input: { id, text: '第二次发送' } });
  await second;
  expect(session.systemPrompt).toContain('重载期间再次修改');
});

it('内置写作指令禁止向作者暴露内部 ID 并要求简要说明连带记录的事件与关系', async () => {
  const bootstrapped = await createHostApplication({
    cwd: join(root, 'boot-work'),
    agentDir: join(root, 'boot-agent'),
    configDir: join(root, 'boot-config'),
    sessionDir: join(root, 'boot-sessions'),
    settingsFile: join(root, 'boot-data', 'settings.json')
  });
  try {
    const delivery = bootstrapped.snapshot().settings.defaultInstructions.find(item => item.name === '交流与交付')!;
    expect(delivery.text).toContain('标题');
    expect(delivery.text).toContain('UUID');
    expect(delivery.text).toContain('事件');
  } finally {
    await bootstrapped.dispose();
  }
});
