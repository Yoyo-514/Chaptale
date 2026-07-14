import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationStore } from '@/stores/notification';
import MessageItem from '../../components/message/MessageItem.vue';

const stubs = {
  UserMessage: {
    props: ['content', 'contextFiles', 'images', 'editing'],
    emits: ['save', 'cancel'],
    template:
      '<div class="stub-user"><span>{{ content }}</span><span class="stub-files">{{ contextFiles[0]?.name }}</span><span class="stub-images">{{ images.length }}</span><button class="save" @click="$emit(\'save\', \'edited\')">save</button><button class="cancel" @click="$emit(\'cancel\')">cancel</button></div>'
  },
  AssistantMessage: {
    props: ['content', 'reasoning', 'partial'],
    template: '<div class="stub-assistant">{{ content }} {{ reasoning }} {{ partial }}</div>'
  },
  ToolCallRequest: { props: ['name', 'args'], template: '<div class="stub-tool-call">{{ name }}</div>' },
  ToolCallResult: {
    props: ['name', 'content'],
    template: '<div class="stub-tool-result">{{ name }} {{ content }}</div>'
  },
  ErrorMessage: { props: ['title', 'content'], template: '<div class="stub-error">{{ title }} {{ content }}</div>' },
  MessageActions: {
    props: ['canEdit', 'canRegenerate'],
    emits: ['copy', 'edit', 'regenerate'],
    template:
      '<div class="stub-actions"><button class="copy" @click="$emit(\'copy\')">copy</button><button class="edit" @click="$emit(\'edit\')" :disabled="!canEdit">edit</button><button class="regen" @click="$emit(\'regenerate\')" :disabled="!canRegenerate">regen</button></div>'
  },
  UserBranchNavigator: {
    props: ['branch'],
    emits: ['switchBranch'],
    template: '<button class="stub-branch" @click="$emit(\'switchBranch\', branch.nextLeafId)">branch</button>'
  },
  AppImagePreview: {
    props: ['items'],
    template: '<div class="stub-image-preview">{{ items.length }}</div>'
  }
};

function mountMessage(
  message: any,
  options: {
    branch?: { current: number; total: number; previousLeafId?: string; nextLeafId?: string };
    isEditing?: boolean;
    isBusy?: boolean;
    compactionBefore?: { summary: string; tokensBefore: number };
  } = {}
) {
  return mount(MessageItem, {
    props: {
      displayMessage: {
        id: 'display-1',
        message,
        branch: options.branch,
        compactionBefore: options.compactionBefore
      },
      isEditing: Boolean(options.isEditing),
      isBusy: Boolean(options.isBusy)
    },
    global: { stubs }
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) }
  });
});

describe('MessageItem', () => {
  it('renders user messages, emits edit/save/cancel/branch events, and copies raw text', async () => {
    const wrapper = mountMessage(
      { role: 'user', content: '用户消息' },
      { branch: { current: 1, total: 2, nextLeafId: 'leaf-2' }, isEditing: true }
    );

    await wrapper.find('.save').trigger('click');
    await wrapper.find('.cancel').trigger('click');
    await wrapper.setProps({ isEditing: false });
    await wrapper.find('.copy').trigger('click');
    await wrapper.find('.stub-branch').trigger('click');

    expect(wrapper.text()).toContain('用户消息');
    expect(wrapper.emitted('saveUser')).toEqual([['display-1', 'edited']]);
    expect(wrapper.emitted('cancelEdit')).toHaveLength(1);
    expect(wrapper.emitted('switchBranch')).toEqual([['leaf-2']]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('用户消息');
  });

  it('renders assistant text, tool calls, retry errors, and regenerate actions', async () => {
    const assistant = mountMessage({ role: 'assistant', content: [{ type: 'text', text: '回答' }], partial: false });
    expect(assistant.text()).toContain('回答');
    await assistant.find('.regen').trigger('click');
    expect(assistant.emitted('regenerateAssistant')).toEqual([['display-1']]);

    const toolCall = mountMessage({
      role: 'assistant',
      content: [{ type: 'toolCall', id: '1', name: 'web_search', arguments: { query: 'q' } }]
    });
    expect(toolCall.text()).toContain('web_search');

    const retry = mountMessage({
      role: 'assistant',
      content: [],
      stopReason: 'error',
      errorMessage: '失败',
      retry: { status: 'retrying', attempt: 1, maxAttempts: 3, delayMs: 1200, errorMessage: '失败' }
    });
    expect(retry.text()).toContain('正在重试 1/3，约 2 秒后继续');
  });

  it('renders tool results and reports clipboard failures', async () => {
    const notificationStore = useNotificationStore();
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'));
    const wrapper = mountMessage({
      role: 'toolResult',
      toolCallId: '1',
      toolName: 'fetch_content',
      content: [{ type: 'text', text: '结果' }]
    });

    expect(wrapper.text()).toContain('fetch_content 结果');
    await wrapper.find('.copy').trigger('click');
    expect(notificationStore.items.at(-1)).toMatchObject({ kind: 'error', title: '复制失败', description: 'denied' });
  });

  it('renders attachment-only user messages', () => {
    const wrapper = mountMessage({
      role: 'user',
      content: '',
      contextFiles: [{ path: 'C:/novel/outline.md', name: 'outline.md', size: 2048, kind: 'text' }]
    });

    expect(wrapper.find('.stub-files').text()).toBe('outline.md');
    expect(wrapper.find('.edit').attributes('disabled')).toBeDefined();
  });

  it('renders native pi image-only user messages', () => {
    const wrapper = mountMessage({
      role: 'user',
      content: [
        {
          type: 'imageAttachment',
          id: 'image-1',
          mimeType: 'image/webp',
          originalBytes: 3,
          width: 100,
          height: 80,
          thumbnailDataUrl: 'data:image/webp;base64,YWJj'
        }
      ]
    });

    expect(wrapper.find('.stub-images').text()).toBe('1');
    expect(wrapper.find('.edit').attributes('disabled')).toBeDefined();
  });

  it('does not render empty messages', () => {
    const wrapper = mountMessage({ role: 'assistant', content: [] });
    expect(wrapper.html()).toBe('<!--v-if-->');
  });

  it('renders mixed replay content with text and every tool call', () => {
    const wrapper = mountMessage({
      role: 'assistant',
      content: [
        { type: 'text', text: '我先搜索再读取。' },
        { type: 'toolCall', id: 't1', name: 'web_search', arguments: { query: 'a' } },
        { type: 'toolCall', id: 't2', name: 'fetch_content', arguments: { urls: [] } }
      ]
    });

    expect(wrapper.find('.stub-assistant').text()).toContain('我先搜索再读取。');
    const toolCalls = wrapper.findAll('.stub-tool-call');
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]?.text()).toBe('web_search');
    expect(toolCalls[1]?.text()).toBe('fetch_content');
  });

  it('marks aborted and truncated replies', () => {
    const aborted = mountMessage({
      role: 'assistant',
      content: [{ type: 'text', text: '写到一半' }],
      stopReason: 'aborted'
    });
    expect(aborted.find('.message-stop-notice').text()).toContain('已手动停止');

    const truncated = mountMessage({
      role: 'assistant',
      content: [{ type: 'text', text: '太长了' }],
      stopReason: 'length'
    });
    expect(truncated.find('.message-stop-notice').text()).toContain('达到输出长度上限');

    const normal = mountMessage({ role: 'assistant', content: [{ type: 'text', text: '完整' }], stopReason: 'stop' });
    expect(normal.find('.message-stop-notice').exists()).toBe(false);
  });

  it('shows timestamp and token usage in the hover meta line', () => {
    const wrapper = mountMessage({
      role: 'assistant',
      content: [{ type: 'text', text: '回答' }],
      timestamp: new Date('2026-07-11T08:30:00').getTime(),
      usage: { inputTokens: 900, outputTokens: 300, totalTokens: 1200, cost: 0.0042 }
    });

    const meta = wrapper.find('.message-meta').text();
    expect(meta).toContain('1.2K tokens');
    expect(meta).toContain('$0.0042');

    const noUsage = mountMessage({ role: 'assistant', content: [{ type: 'text', text: '回答' }] });
    expect(noUsage.find('.message-meta').exists()).toBe(false);
  });

  it('renders a compaction notice above the message when history was compacted', () => {
    const wrapper = mountMessage(
      { role: 'user', content: '继续' },
      { compactionBefore: { summary: '之前讨论了大纲。', tokensBefore: 32000 } }
    );

    const notice = wrapper.find('.message-compaction');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain('32.0K');
    expect(notice.text()).toContain('之前讨论了大纲。');
  });

  it('renders inline images from assistant and tool result messages', () => {
    const assistant = mountMessage({
      role: 'assistant',
      content: [{ type: 'image', data: 'YWJj', mimeType: 'image/png' }]
    });
    expect(assistant.find('.stub-image-preview').text()).toBe('1');

    const toolResult = mountMessage({
      role: 'toolResult',
      toolCallId: '1',
      toolName: 'render_chart',
      content: [
        { type: 'text', text: '图表已生成' },
        { type: 'image', data: 'YWJj', mimeType: 'image/png' },
        { type: 'image', data: 'ZGVm', mimeType: 'image/jpeg' }
      ]
    });
    expect(toolResult.find('.stub-image-preview').text()).toBe('2');
  });
});
