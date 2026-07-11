import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import ToolMessageGroup from '../../components/message/ToolMessageGroup.vue';

const messages = [
  {
    id: 'assistant-tool',
    message: {
      role: 'assistant' as const,
      content: [{ type: 'toolCall' as const, id: 'call-1', name: 'read', arguments: { path: 'a.ts' } }]
    }
  },
  {
    id: 'tool-result',
    message: {
      role: 'toolResult' as const,
      toolCallId: 'call-1',
      toolName: 'read',
      content: [{ type: 'text' as const, text: 'file content' }]
    }
  }
];

describe('ToolMessageGroup', () => {
  it('pairs a tool call and result into one execution', async () => {
    const wrapper = mount(ToolMessageGroup, { props: { messages } });

    expect(wrapper.get('.tool-message-group').attributes('data-state')).toBe('closed');
    expect(wrapper.get('.tool-message-group-summary').text()).toBe('1 次调用 · 已完成');

    await wrapper.get('.tool-message-group-trigger').trigger('click');

    const executions = wrapper.findAll('.tool-execution');
    expect(executions).toHaveLength(1);
    expect(executions[0]?.text()).toContain('Read · a.ts');
    expect(executions[0]?.text()).toContain('已完成');

    await executions[0]?.get('.tool-execution-trigger').trigger('click');
    const sections = executions[0]?.findAll('.tool-message-section-title') ?? [];
    expect(sections.map(section => section.text())).toEqual(['调用 · Read', '结果 · Read']);
  });

  it('opens the group, execution, and result section for a result search hit', () => {
    const wrapper = mount(ToolMessageGroup, {
      props: {
        messages,
        searchHit: { id: 'tool-result', index: 1, toolTarget: { callId: 'call-1', section: 'result' } }
      }
    });

    expect(wrapper.get('.tool-message-group').attributes('data-state')).toBe('open');
    expect(wrapper.get('.tool-execution').attributes('data-state')).toBe('open');
    expect(wrapper.get('.tool-message-section.is-search-hit').text()).toContain('结果 · Read');
    expect(wrapper.get('.tool-message-section.is-search-hit').attributes('data-state')).toBe('open');
  });

  it('reacts to switching the active search hit to tool call arguments', async () => {
    const wrapper = mount(ToolMessageGroup, { props: { messages } });

    await wrapper.setProps({
      searchHit: { id: 'assistant-tool', index: 0, toolTarget: { callId: 'call-1', section: 'call' } }
    });
    await nextTick();

    expect(wrapper.get('.tool-message-group').attributes('data-state')).toBe('open');
    expect(wrapper.get('.tool-execution').attributes('data-state')).toBe('open');
    expect(wrapper.get('.tool-message-section.is-search-hit').text()).toContain('调用 · Read');
    expect(wrapper.get('.tool-message-section.is-search-hit').attributes('data-state')).toBe('open');
  });

  it('shows up to three unique tool names and updates for parallel calls', async () => {
    const wrapper = mount(ToolMessageGroup, { props: { messages: [messages[0]!] } });
    expect(wrapper.get('.tool-message-group-title').text()).toBe('Read');

    await wrapper.setProps({
      messages: [
        {
          id: 'parallel-tools',
          message: {
            role: 'assistant',
            content: [
              { type: 'toolCall', id: 'c1', name: 'read', arguments: {} },
              { type: 'toolCall', id: 'c2', name: 'edit', arguments: {} },
              { type: 'toolCall', id: 'c3', name: 'bash', arguments: {} },
              { type: 'toolCall', id: 'c4', name: 'web_search', arguments: {} },
              { type: 'toolCall', id: 'c5', name: 'read', arguments: {} }
            ]
          }
        }
      ]
    });

    expect(wrapper.get('.tool-message-group-title').text()).toBe('Read、Edit、Bash 等 4 种');
    expect(wrapper.get('.tool-message-group-summary').text()).toContain('5 次调用');
  });

  it('shows tool result images as a large gallery outside the collapsed group', () => {
    const wrapper = mount(ToolMessageGroup, {
      props: {
        messages: [
          messages[0]!,
          {
            id: 'tool-result',
            message: {
              role: 'toolResult' as const,
              toolCallId: 'call-1',
              toolName: 'read',
              content: [
                { type: 'image' as const, data: 'YWJj', mimeType: 'image/png' },
                { type: 'image' as const, data: 'ZGVm', mimeType: 'image/jpeg' }
              ]
            }
          }
        ]
      }
    });

    expect(wrapper.get('.tool-message-group').attributes('data-state')).toBe('closed');
    const images = wrapper.findAll('.app-image-gallery-image');
    expect(images).toHaveLength(2);
    expect(images[0]?.attributes('src')).toBe('data:image/png;base64,YWJj');
  });

  it('renders failed tool results with an error icon and status', async () => {
    const wrapper = mount(ToolMessageGroup, {
      props: {
        messages: [
          messages[0]!,
          {
            id: 'tool-result-error',
            message: {
              role: 'toolResult',
              toolCallId: 'call-1',
              toolName: 'read',
              isError: true,
              content: [{ type: 'text', text: 'edit failed' }]
            }
          }
        ]
      }
    });

    await wrapper.get('.tool-message-group-trigger').trigger('click');
    await wrapper.get('.tool-execution-trigger').trigger('click');

    expect(wrapper.get('.tool-execution-status').text()).toBe('失败');
    expect(wrapper.get('.tool-message-section-status').text()).toBe('失败');
    expect(
      wrapper
        .findAll('.tool-message-section-icon')
        .some(icon => icon.classes().includes('i-mingcute-close-circle-line'))
    ).toBe(true);
  });

  it('marks executions without a result as interrupted once the session is idle', async () => {
    const callOnly = [messages[0]!];

    const idle = mount(ToolMessageGroup, { props: { messages: callOnly, isBusy: false } });
    expect(idle.get('.tool-message-group-summary').text()).toBe('1 次调用 · 部分已中断');
    await idle.get('.tool-message-group-trigger').trigger('click');
    expect(idle.get('.tool-execution-status').text()).toBe('已中断');

    const busy = mount(ToolMessageGroup, { props: { messages: callOnly, isBusy: true } });
    expect(busy.get('.tool-message-group-summary').text()).toBe('1 次调用 · 0 次已完成');
    await busy.get('.tool-message-group-trigger').trigger('click');
    expect(busy.get('.tool-execution-status').text()).toBe('执行中');
  });

  it('keeps the compaction notice visible for tool-only assistant messages', () => {
    const wrapper = mount(ToolMessageGroup, {
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
