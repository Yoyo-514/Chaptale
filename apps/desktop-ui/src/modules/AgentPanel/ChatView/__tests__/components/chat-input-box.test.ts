import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ChatInputBox from '../../components/ChatInput/ChatInputBox.vue';

function mountInput(props?: Partial<InstanceType<typeof ChatInputBox>['$props']>) {
  return mount(ChatInputBox, {
    props: {
      modelValue: '写一个故事',
      isConnecting: false,
      isReplying: false,
      isEnabledWebSearch: true,
      contextFiles: [],
      modelLabel: 'openai / gpt-4.1',
      workspaceLabel: '全局会话',
      ...props
    }
  });
}

describe('ChatInputBox', () => {
  it('submits non-empty input and emits user edits', async () => {
    const wrapper = mountInput();
    const textarea = wrapper.find('textarea');

    expect(textarea.classes()).toContain('app-textarea-lg');
    expect(textarea.classes()).not.toContain('app-textarea-sm');
    await textarea.setValue('新的创作需求');
    await wrapper.find('.chat-send-button').trigger('click');

    expect(wrapper.emitted('update:modelValue')).toEqual([['新的创作需求']]);
    expect(wrapper.emitted('submit')).toHaveLength(1);
  });

  it('does not submit empty input when idle', async () => {
    const wrapper = mountInput({ modelValue: '   ' });

    await wrapper.find('.chat-send-button').trigger('click');

    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('emits submit as cancel when replying even if a retry is connecting', async () => {
    const wrapper = mountInput({ isReplying: true, isConnecting: true, modelValue: '' });

    await wrapper.find('.chat-send-button').trigger('click');

    expect(wrapper.find('.i-mingcute-loading-line').exists()).toBe(true);
    expect(wrapper.emitted('submit')).toHaveLength(1);
  });

  it('toggles web search from the toolbar and exposes pressed state', async () => {
    const wrapper = mountInput({ isEnabledWebSearch: false });
    const toggle = wrapper.find('button[aria-pressed="false"]');

    expect(toggle.attributes('aria-pressed')).toBe('false');
    expect(toggle.text()).toContain('离线');

    await toggle.trigger('click');

    expect(wrapper.emitted('toggleWebSearch')).toHaveLength(1);
  });

  it('renders the status bar below the input container and opens settings sections', async () => {
    const wrapper = mountInput();
    const statusItems = wrapper.findAll('.chat-status-item');

    expect(wrapper.find('.chat-input-container + .chat-status-bar').exists()).toBe(true);
    expect(statusItems[0]?.text()).toContain('openai / gpt-4.1');
    expect(statusItems[1]?.text()).toContain('全局会话');

    await statusItems[0]?.trigger('click');
    await statusItems[1]?.trigger('click');

    expect(wrapper.emitted('openSettings')).toEqual([['llm'], ['workspace']]);
  });

  it('shows context file previews and emits removals', async () => {
    const wrapper = mountInput({
      contextFiles: [
        {
          path: 'C:/novel/outline.md',
          name: 'outline.md',
          size: 2048,
          kind: 'text'
        },
        {
          path: 'C:/novel/cover.png',
          name: 'cover.png',
          size: 4096,
          kind: 'image',
          mimeType: 'image/png',
          previewDataUrl: 'data:image/png;base64,abc'
        }
      ]
    });

    const cards = wrapper.findAll('.chat-context-file-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.text()).toContain('outline.md');
    expect(cards[0]?.text()).toContain('2 KB');
    expect(wrapper.find('.app-image-thumbnail-image').attributes('src')).toBe('data:image/png;base64,abc');

    await cards[0]?.find('button[aria-label="移除"]').trigger('click');

    expect(wrapper.emitted('removeContextFile')).toEqual([['C:/novel/outline.md']]);
  });

  it('emits dropped files when a file payload is dropped onto the input', async () => {
    const wrapper = mountInput();
    const droppedFile = new File(['大纲'], 'outline.md', { type: 'text/markdown' });

    await wrapper.find('.chat-input-container').trigger('drop', {
      dataTransfer: { types: ['Files'], files: [droppedFile] }
    });

    expect(wrapper.emitted('dropContextFiles')).toEqual([[[droppedFile]]]);
  });
});
