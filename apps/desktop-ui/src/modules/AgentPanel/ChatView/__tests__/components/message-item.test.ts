import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationStore } from '@/stores/notification';
import MessageItem from '../../components/message/MessageItem.vue';

const stubs = {
  UserMessage: {
    props: ['content', 'editing'],
    emits: ['save', 'cancel'],
    template:
      '<div class="stub-user"><span>{{ content }}</span><button class="save" @click="$emit(\'save\', \'edited\')">save</button><button class="cancel" @click="$emit(\'cancel\')">cancel</button></div>'
  },
  AssistantMessage: {
    props: ['content', 'reasoning', 'partial'],
    template: '<div class="stub-assistant">{{ content }} {{ reasoning }} {{ partial }}</div>'
  },
  ToolCallMessage: { props: ['name', 'args'], template: '<div class="stub-tool-call">{{ name }}</div>' },
  ToolResultMessage: {
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
  }
};

function mountMessage(
  message: any,
  options: {
    branch?: { current: number; total: number; previousLeafId?: string; nextLeafId?: string };
    isEditing?: boolean;
    isBusy?: boolean;
  } = {}
) {
  return mount(MessageItem, {
    props: {
      displayMessage: { id: 'display-1', message, branch: options.branch },
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

  it('does not render empty messages', () => {
    const wrapper = mountMessage({ role: 'assistant', content: [] });
    expect(wrapper.html()).toBe('<!--v-if-->');
  });
});
