import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import ToolCallGroup from '../../components/message/ToolCallGroup.vue';

const messages = [
  {
    id: 'assistant-tool',
    message: {
      role: 'assistant' as const,
      content: '',
      toolCalls: [{ id: 'call-1', name: 'read', arguments: { path: 'a.ts' } }]
    }
  },
  {
    id: 'tool-result',
    message: {
      role: 'tool' as const,
      toolCallId: 'call-1',
      toolName: 'read',
      output: 'file content'
    }
  }
];

describe('ToolCallGroup', () => {
  it('pairs a tool call and result into one execution', async () => {
    const wrapper = mount(ToolCallGroup, { props: { messages } });

    expect(wrapper.get('.tool-call-group').attributes('data-state')).toBe('closed');
    expect(wrapper.get('.tool-call-group-summary').text()).toBe('1 次调用 · 已完成');

    await wrapper.get('.tool-call-group-trigger').trigger('click');

    const executions = wrapper.findAll('.tool-call-item');
    expect(executions).toHaveLength(1);
    expect(executions[0]?.text()).toContain('Read · a.ts');
    expect(executions[0]?.text()).toContain('已完成');

    await executions[0]?.get('.tool-call-item-trigger').trigger('click');
    const sections = executions[0]?.findAll('.tool-call-section-title') ?? [];
    expect(sections.map(section => section.text())).toEqual(['调用 · Read', '结果 · Read']);
  });

  it('opens the group, execution, and result section for a result search hit', () => {
    const wrapper = mount(ToolCallGroup, {
      props: {
        messages,
        searchHit: { id: 'tool-result', index: 1, toolTarget: { callId: 'call-1', section: 'result' } }
      }
    });

    expect(wrapper.get('.tool-call-group').attributes('data-state')).toBe('open');
    expect(wrapper.get('.tool-call-item').attributes('data-state')).toBe('open');
    expect(wrapper.get('.tool-call-section.is-search-hit').text()).toContain('结果 · Read');
    expect(wrapper.get('.tool-call-section.is-search-hit').attributes('data-state')).toBe('open');
  });

  it('reacts to switching the active search hit to tool call arguments', async () => {
    const wrapper = mount(ToolCallGroup, { props: { messages } });

    await wrapper.setProps({
      searchHit: { id: 'assistant-tool', index: 0, toolTarget: { callId: 'call-1', section: 'call' } }
    });
    await nextTick();

    expect(wrapper.get('.tool-call-group').attributes('data-state')).toBe('open');
    expect(wrapper.get('.tool-call-item').attributes('data-state')).toBe('open');
    expect(wrapper.get('.tool-call-section.is-search-hit').text()).toContain('调用 · Read');
    expect(wrapper.get('.tool-call-section.is-search-hit').attributes('data-state')).toBe('open');
  });

  it('shows up to three unique tool names and updates for parallel calls', async () => {
    const wrapper = mount(ToolCallGroup, { props: { messages: [messages[0]!] } });
    expect(wrapper.get('.tool-call-group-title').text()).toBe('Read');

    await wrapper.setProps({
      messages: [
        {
          id: 'parallel-tools',
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'c1', name: 'read', arguments: {} },
              { id: 'c2', name: 'edit', arguments: {} },
              { id: 'c3', name: 'bash', arguments: {} },
              { id: 'c4', name: 'web_search', arguments: {} },
              { id: 'c5', name: 'read', arguments: {} }
            ]
          }
        }
      ]
    });

    expect(wrapper.get('.tool-call-group-title').text()).toBe('Read、Edit、Bash 等 4 种');
    expect(wrapper.get('.tool-call-group-summary').text()).toContain('5 次调用');
  });

  it('shows tool result images as a large gallery outside the collapsed group', () => {
    const wrapper = mount(ToolCallGroup, {
      props: {
        messages: [
          messages[0]!,
          {
            id: 'tool-result',
            message: {
              role: 'tool' as const,
              toolCallId: 'call-1',
              toolName: 'read',
              output: {
                images: [
                  {
                    type: 'imageAttachment',
                    id: 'img-1',
                    mimeType: 'image/png',
                    originalBytes: 3,
                    width: 100,
                    height: 80,
                    thumbnailDataUrl: 'data:image/png;base64,YWJj'
                  },
                  {
                    type: 'imageAttachment',
                    id: 'img-2',
                    mimeType: 'image/jpeg',
                    originalBytes: 3,
                    width: 100,
                    height: 80,
                    thumbnailDataUrl: 'data:image/jpeg;base64,ZGVm'
                  }
                ]
              }
            }
          }
        ]
      }
    });

    expect(wrapper.get('.tool-call-group').attributes('data-state')).toBe('closed');
    const images = wrapper.findAll('.app-image-gallery-image');
    expect(images).toHaveLength(2);
    expect(images[0]?.attributes('src')).toBe('data:image/png;base64,YWJj');
  });

  it('renders failed tool results with an error icon and status', async () => {
    const wrapper = mount(ToolCallGroup, {
      props: {
        messages: [
          messages[0]!,
          {
            id: 'tool-result-error',
            message: {
              role: 'tool',
              toolCallId: 'call-1',
              toolName: 'read',
              isError: true,
              output: 'edit failed'
            }
          }
        ]
      }
    });

    await wrapper.get('.tool-call-group-trigger').trigger('click');
    await wrapper.get('.tool-call-item-trigger').trigger('click');

    expect(wrapper.get('.tool-call-item-status').text()).toBe('失败');
    expect(wrapper.get('.tool-call-section-status').text()).toBe('失败');
    expect(
      wrapper.findAll('.tool-call-section-icon').some(icon => icon.classes().includes('i-mingcute-close-circle-line'))
    ).toBe(true);
  });

  it('中断补位显示为已中断，不冒充工具失败', async () => {
    const wrapper = mount(ToolCallGroup, {
      props: {
        messages: [
          messages[0]!,
          {
            id: 'tool-result-interrupted',
            message: {
              role: 'tool',
              toolCallId: 'call-1',
              toolName: 'read',
              // 补位同样带 isError（模型那边只认「有没有可用结果」），界面必须靠 interrupted 分辨。
              isError: true,
              interrupted: true,
              output: '工具未执行：本次运行已中断。'
            }
          }
        ]
      }
    });

    // 补位不算完成：否则中断过的会话重开后，头部说「已完成」、展开却是「已中断」。
    expect(wrapper.get('.tool-call-group-summary').text()).toBe('1 次调用 · 部分已中断');

    await wrapper.get('.tool-call-group-trigger').trigger('click');
    await wrapper.get('.tool-call-item-trigger').trigger('click');

    expect(wrapper.get('.tool-call-item-status').text()).toBe('已中断');
    expect(wrapper.get('.tool-call-item-status').classes()).not.toContain('is-error');
    expect(wrapper.get('.tool-call-section-status').text()).toBe('已中断');
  });

  it('marks executions without a result as interrupted once the session is idle', async () => {
    const callOnly = [messages[0]!];

    const idle = mount(ToolCallGroup, { props: { messages: callOnly, isBusy: false } });
    expect(idle.get('.tool-call-group-summary').text()).toBe('1 次调用 · 部分已中断');
    await idle.get('.tool-call-group-trigger').trigger('click');
    expect(idle.get('.tool-call-item-status').text()).toBe('已中断');

    const busy = mount(ToolCallGroup, { props: { messages: callOnly, isBusy: true } });
    expect(busy.get('.tool-call-group-summary').text()).toBe('1 次调用 · 0 次已完成');
    await busy.get('.tool-call-group-trigger').trigger('click');
    expect(busy.get('.tool-call-item-status').text()).toBe('执行中');
  });

  it('keeps the compaction notice visible for tool-only assistant messages', () => {
    const wrapper = mount(ToolCallGroup, {
      props: {
        messages: [
          { ...messages[0]!, compactionBefore: { summary: '之前讨论了大纲。', tokensBefore: 32000 } },
          messages[1]!
        ]
      }
    });

    const notice = wrapper.get('.message-compaction');
    expect(notice.text()).toContain('32.0K');
    expect(notice.text()).toContain('之前讨论了大纲。');
  });
});
