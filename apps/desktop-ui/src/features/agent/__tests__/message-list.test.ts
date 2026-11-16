import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, expect, it } from 'vitest';

import type { ChatMessage, HostState, SessionView } from '@chaptale/agent-host/protocol';
import { CreationApplication } from '@chaptale/creation/application';
import { openCreationStorage } from '@chaptale/storage';

import { useCreationStore } from '@/features/creation';
import { useEditorStore } from '@/features/editor';

import MessageList from '../components/MessageList.vue';
import { applyHostEvent } from '../session/host-events';

let wrapper: VueWrapper | undefined;
afterEach(() => wrapper?.unmount());

const message = (fields: Partial<ChatMessage> & Pick<ChatMessage, 'role'>): ChatMessage => ({
  text: '',
  thinking: '',
  tools: [],
  ...fields
});

function session(messages: ChatMessage[], running = false): SessionView {
  return {
    id: 'session',
    sessionId: 'session',
    file: 'history.jsonl',
    workId: 'work',
    running,
    compacting: false,
    instructions: [],
    mode: 'review',
    messages
  };
}

it('原生子调用增量到达时刷新动作计数，完成记录替换临时摘要', async () => {
  const state: HostState = {
    cursor: 0,
    tools: [],
    models: [],
    approvals: [],
    settings: {
      defaultInstructions: [],
      defaultMode: 'review',
      lastModel: null,
      namedInstructions: [],
      toolPermissions: []
    },
    sessions: [
      session(
        [message({ role: 'assistant', tools: [{ id: 'script', name: 'codemode', input: { code: '批量操作' } }] })],
        true
      )
    ]
  };
  applyHostEvent(state, {
    cursor: 1,
    kind: 'tool',
    id: 'session',
    index: 0,
    parentCallId: 'script',
    call: { id: 'script/1', name: 'work_write', preview: { section: 'resource', title: '沈霁' }, status: 'running' }
  });
  wrapper = mount(MessageList, { props: { session: state.sessions[0]!, approvals: [], outgoing: [] } });
  expect(wrapper.text()).toContain('新建资料 1 份');
  applyHostEvent(state, {
    cursor: 2,
    kind: 'tool',
    id: 'session',
    index: 0,
    parentCallId: 'script',
    call: { id: 'script/2', name: 'work_record_write', preview: { text: '沈霁抵达渡口' }, status: 'running' }
  });
  await wrapper.setProps({ session: { ...state.sessions[0]! } });
  expect(wrapper.text()).toContain('新建资料 1 份 · 记录事件 1 条');
  applyHostEvent(state, {
    cursor: 3,
    kind: 'message',
    id: 'session',
    index: 1,
    message: message({
      role: 'toolResult',
      toolCallId: 'script',
      toolName: 'codemode',
      text: '脚本原始输出',
      nestedTools: [
        { id: 'script/1', name: 'work_write', input: { section: 'resource', title: '沈霁' }, status: 'ok' },
        { id: 'script/2', name: 'work_record_write', input: { text: '沈霁抵达渡口' }, status: 'ok' }
      ],
      nestedToolsComplete: true
    })
  });
  await wrapper.setProps({ session: { ...state.sessions[0]!, running: false } });
  expect(state.sessions[0]!.messages[0].tools[0].nestedTools).toBeUndefined();
  expect(wrapper.text()).toContain('新建资料 1 份 · 记录事件 1 条');
});

it('作者消息仅在有选区时于气泡上方显示引用块，普通整章关联不占空间', async () => {
  wrapper = mount(MessageList, {
    props: {
      session: session([
        message({
          role: 'user',
          text: '润色这里',
          editorContext: {
            workId: 'work',
            entryId: 'chapter-id',
            title: '第三回',
            section: 'manuscript',
            selection: '将军守城，公主远行。'
          }
        }),
        message({
          role: 'user',
          text: '整章看看节奏',
          editorContext: {
            workId: 'work',
            entryId: 'chapter-id',
            title: '第四回',
            section: 'manuscript'
          }
        })
      ]),
      approvals: [],
      outgoing: []
    }
  });
  const users = wrapper.findAll('.agent-user-body');
  expect(users).toHaveLength(2);
  expect(users[0]!.element.firstElementChild?.getAttribute('aria-label')).toBe('编辑上下文');
  const context = users[0]!.get('[aria-label="编辑上下文"]');
  expect(context.text()).toContain('文稿《第三回》选区');
  await context.get('summary').trigger('click');
  expect(context.text()).toContain('将军守城，公主远行。');
  expect(context.text()).not.toContain('chapter-id');
  expect(users[1]!.find('[aria-label="编辑上下文"]').exists()).toBe(false);
});

it('连续读取合为一行，完成后折叠，先展开动作再查看原始参数和结果', async () => {
  wrapper = mount(MessageList, {
    props: {
      session: session([
        message({ role: 'assistant', tools: [{ id: 'a', name: 'read', input: { path: '正文/第一章.md' } }] }),
        message({ role: 'toolResult', toolCallId: 'a', toolName: 'read', text: '第一章的完整原文' }),
        message({ role: 'assistant', tools: [{ id: 'b', name: 'read', input: { path: '正文/第二章.md' } }] }),
        message({ role: 'toolResult', toolCallId: 'b', toolName: 'read', text: '第二章的完整原文' }),
        message({ role: 'assistant', text: '两章都读完了。' })
      ]),
      approvals: [],
      outgoing: []
    }
  });
  const group = wrapper.findAll('button').find(button => button.text() === '读取 2 份');
  expect(group).toBeDefined();
  expect(wrapper.text()).not.toContain('第一章.md');
  await group!.trigger('click');
  expect(wrapper.text()).toContain('第一章.md');
  expect(wrapper.text()).toContain('第二章.md');
  expect(wrapper.text()).not.toContain('第一章的完整原文');
  await wrapper
    .findAll('button')
    .find(button => button.text().includes('第一章.md'))!
    .trigger('click');
  expect(wrapper.text()).toContain('第一章的完整原文');
  expect(wrapper.text()).not.toContain('第二章的完整原文');
});

it('同名工具乱序返回时，失败项对应实际调用并在折叠组下方显示', () => {
  wrapper = mount(MessageList, {
    props: {
      session: session([
        message({
          role: 'assistant',
          tools: [
            { id: 'a', name: 'read', input: { path: '正文/第一章.md' } },
            { id: 'b', name: 'read', input: { path: '正文/第二章.md' } }
          ]
        }),
        message({ role: 'toolResult', toolCallId: 'b', toolName: 'read', text: '读取第二章失败', error: true }),
        message({ role: 'toolResult', toolCallId: 'a', toolName: 'read', text: '第一章原文' })
      ]),
      approvals: [],
      outgoing: []
    }
  });
  expect(wrapper.text()).toContain('读取 2 份');
  expect(wrapper.text()).toContain('未能读取 正文/第二章.md');
  expect(wrapper.text()).not.toContain('未能读取 正文/第一章.md');
});

it('业务动作按类型计数，展开后用标题与字数展示，原始身份只在详情中出现', async () => {
  wrapper = mount(MessageList, {
    props: {
      session: session([
        message({
          role: 'assistant',
          tools: [
            { id: 'r', name: 'work_read', input: { workId: 'work-id', entryId: 'chapter-id' } },
            {
              id: 'w',
              name: 'work_write',
              input: { workId: 'work-id', section: 'resource', title: '沈霁', content: '人物资料' }
            }
          ]
        }),
        message({
          role: 'toolResult',
          toolCallId: 'r',
          toolName: 'work_read',
          text: '原始读取结果',
          toolInfo: { title: '第三回', section: 'manuscript', wordCount: 3412 }
        }),
        message({
          role: 'toolResult',
          toolCallId: 'w',
          toolName: 'work_write',
          text: '原始新建结果',
          toolInfo: { title: '沈霁', section: 'resource' }
        })
      ]),
      approvals: [],
      outgoing: []
    }
  });
  const group = wrapper.findAll('button').find(button => button.text() === '读取 1 份 · 新建资料 1 份');
  expect(group).toBeDefined();
  await group!.trigger('click');
  expect(wrapper.text()).toContain('读取《第三回》3,412 字');
  expect(wrapper.text()).toContain('新建资料《沈霁》');
  expect(wrapper.text()).not.toContain('work_read');
  expect(wrapper.text()).not.toContain('chapter-id');
});

it('脚本里的原生子调用按实际动作计数，失败单列，脚本保留原始输出', async () => {
  wrapper = mount(MessageList, {
    props: {
      session: session([
        message({ role: 'assistant', tools: [{ id: 'script', name: 'codemode', input: { code: '执行业务操作' } }] }),
        message({
          role: 'toolResult',
          toolCallId: 'script',
          toolName: 'codemode',
          text: '脚本完整原始输出',
          nestedTools: [
            { id: 'script/1', name: 'work_write', input: { section: 'resource', title: '沈霁' }, status: 'ok' },
            { id: 'script/2', name: 'work_record_write', input: { text: '沈霁抵达渡口' }, status: 'ok' },
            {
              id: 'script/3',
              name: 'work_record_write',
              input: { text: '沈霁离开渡口' },
              status: 'error',
              error: '出处已变化'
            }
          ],
          nestedToolsComplete: true
        })
      ]),
      approvals: [],
      outgoing: []
    }
  });
  const group = wrapper.findAll('button').find(button => button.text() === '新建资料 1 份 · 记录事件 2 条');
  expect(group).toBeDefined();
  expect(wrapper.text()).toContain('沈霁离开渡口');
  expect(wrapper.text()).toContain('出处已变化');
  await group!.trigger('click');
  expect(wrapper.text()).toContain('新建资料《沈霁》');
  expect(wrapper.text()).toContain('沈霁抵达渡口');
  const nestedRow = wrapper.findAll('.agent-tool-call.is-nested')[0]!;
  await nestedRow.get('button').trigger('click');
  expect(nestedRow.text()).toContain('"title": "沈霁"');
  expect(nestedRow.text()).not.toContain('"status": "ok"');
  await wrapper
    .findAll('button')
    .find(button => button.text() === '执行脚本')!
    .trigger('click');
  expect(wrapper.text()).toContain('脚本完整原始输出');
});

it('运行中仅当组内仍有未完成调用时转圈，助手正文划分新组，停止后收起的调用可查看', async () => {
  const messages = [message({ role: 'assistant', tools: [{ id: 'a', name: 'read', input: { path: '一.txt' } }] })];
  wrapper = mount(MessageList, { props: { session: session(messages, true), approvals: [], outgoing: [] } });
  expect(wrapper.text()).toContain('读取 1 份');
  expect(wrapper.find('[aria-label="进行中"]').exists()).toBe(true);
  messages.push(message({ role: 'toolResult', toolCallId: 'a', toolName: 'read', text: '一的原文' }));
  await wrapper.setProps({ session: session([...messages], true) });
  expect(wrapper.find('[aria-label="进行中"]').exists()).toBe(false);
  messages.push(message({ role: 'assistant', tools: [{ id: 'b', name: 'read', input: { path: '二.txt' } }] }));
  await wrapper.setProps({ session: session([...messages], true) });
  expect(wrapper.text()).toContain('读取 2 份');
  expect(wrapper.find('[aria-label="进行中"]').exists()).toBe(true);
  messages.push(
    message({
      role: 'assistant',
      text: '接下来处理资料。',
      tools: [{ id: 'c', name: 'read', input: { path: '资料.txt' } }]
    })
  );
  await wrapper.setProps({ session: session([...messages], false) });
  expect(wrapper.findAll('[aria-label="工具调用"]')).toHaveLength(2);
  expect(wrapper.find('[aria-label="进行中"]').exists()).toBe(false);
  const groups = wrapper.findAll('[aria-label="工具调用"]');
  await groups[0]!.get('button').trigger('click');
  expect(groups[0]!.find('[aria-label="已停止"]').exists()).toBe(true);
  expect(wrapper.text()).not.toContain('一的原文');
});

it('支持作者消息原地编辑重发、助手回复重试与分支切换器派发', async () => {
  const editorContext = {
    workId: 'work-1',
    entryId: 'doc-1',
    title: '第一回',
    section: 'manuscript' as const,
    selection: '风雪夜归人'
  };
  wrapper = mount(MessageList, {
    props: {
      session: session([
        message({
          entryId: 'entry-u1',
          role: 'user',
          text: '润色这一句',
          editorContext,
          branch: { index: 2, total: 2, prevLeafId: 'leaf-1' }
        }),
        message({ role: 'assistant', text: '风雪深处，有人踏夜归来。' })
      ]),
      approvals: [],
      outgoing: []
    }
  });

  expect(wrapper.get('[aria-label="分支切换"]').text()).toContain('2 / 2');
  expect(wrapper.get('.agent-user .agent-message-actions').element.lastElementChild?.getAttribute('aria-label')).toBe(
    '分支切换'
  );
  expect(wrapper.get('button[aria-label="下一分支"]').attributes('disabled')).toBeDefined();
  await wrapper.get('button[aria-label="上一分支"]').trigger('click');
  expect(wrapper.emitted('switchBranch')).toEqual([['leaf-1']]);

  await wrapper.get('.agent-user button[aria-label="编辑消息"]').trigger('click');
  const textarea = wrapper.get('textarea[aria-label="编辑消息"]');
  expect((textarea.element as HTMLTextAreaElement).value).toBe('润色这一句');
  await textarea.setValue('改为冷峻克制的语气');
  await wrapper
    .findAll('.agent-user-edit-actions button')
    .find(button => button.text() === '发送')!
    .trigger('click');
  expect(wrapper.emitted('editMessage')?.[0]).toEqual([
    { entryId: 'entry-u1', text: '改为冷峻克制的语气', editorContext }
  ]);

  await wrapper.get('.agent-assistant button[aria-label="重试消息"]').trigger('click');
  expect(wrapper.emitted('editMessage')?.[1]).toEqual([{ entryId: 'entry-u1', text: '润色这一句', editorContext }]);
});

it('展开工具步骤后点击本作品有效文档标题直接在当前编辑组打开标签', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chaptale-tool-open-'));
  const author = new CreationApplication(await openCreationStorage({ rootDir: root }));
  Object.defineProperty(window, 'chaptaleDesktop', {
    configurable: true,
    value: {
      creation: {
        request: (method: string, input: unknown) => author.execute({ method, input } as never),
        subscribe: (listener: (event: unknown) => void) => author.subscribe(listener as never),
        onDisconnected: () => () => {}
      }
    }
  });
  try {
    const workRes = author.executeAuthor({
      method: 'createWork',
      input: { commandId: crypto.randomUUID(), title: '石头记', kind: 'novel' }
    });
    if (!workRes.ok) throw new Error(workRes.error.message);
    const docRes = author.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: crypto.randomUUID(),
        workId: workRes.value.id,
        section: 'manuscript',
        parentId: null,
        kind: 'document',
        title: '第三回',
        format: 'markdown',
        content: '正文内容'
      }
    });
    if (!docRes.ok) throw new Error(docRes.error.message);

    const pinia = createPinia();
    setActivePinia(pinia);
    const creation = useCreationStore();
    await creation.connect();
    await creation.openWork(workRes.value.id);
    const editor = useEditorStore();

    const viewSession: SessionView = {
      id: 'session',
      sessionId: 'session',
      file: 'history.jsonl',
      workId: workRes.value.id,
      running: false,
      compacting: false,
      instructions: [],
      mode: 'review',
      messages: [
        message({
          role: 'assistant',
          tools: [
            {
              id: 'call-1',
              name: 'work_read',
              input: { workId: workRes.value.id, entryId: docRes.value.id },
              info: { workId: workRes.value.id, entryId: docRes.value.id, title: '第三回', section: 'manuscript' }
            }
          ]
        }),
        message({
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'work_read',
          text: '{"ok":true}',
          toolInfo: {
            workId: workRes.value.id,
            entryId: docRes.value.id,
            title: '第三回',
            section: 'manuscript',
            wordCount: 4
          }
        })
      ]
    };

    wrapper = mount(MessageList, {
      props: { session: viewSession, approvals: [], outgoing: [] },
      global: { plugins: [pinia] }
    });
    await wrapper
      .findAll('button')
      .find(button => button.text().includes('读取 1 份'))!
      .trigger('click');
    const openBtn = wrapper.get('button[aria-label="打开《第三回》"]');
    expect(openBtn.text()).toBe('《第三回》');
    await openBtn.trigger('click');
    await flushPromises();
    expect(editor.activeId).toBe(docRes.value.id);
  } finally {
    wrapper?.unmount();
    wrapper = undefined;
    author.close();
    await rm(root, { recursive: true, force: true });
  }
});
