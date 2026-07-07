import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ChatInputBox from '../ChatInputBox.vue';

function mountInput(props?: Partial<InstanceType<typeof ChatInputBox>['$props']>) {
  return mount(ChatInputBox, {
    props: {
      modelValue: '写一个故事',
      isConnecting: false,
      isReplying: false,
      isEnabledWebSearch: true,
      ...props
    }
  });
}

describe('ChatInputBox', () => {
  it('submits non-empty input and emits user edits', async () => {
    const wrapper = mountInput();

    await wrapper.find('input').setValue('新的创作需求');
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
    const toggle = wrapper.find('.chat-websearch-button');

    expect(toggle.attributes('aria-pressed')).toBe('false');
    expect(toggle.text()).toContain('离线');

    await toggle.trigger('click');

    expect(wrapper.emitted('toggleWebSearch')).toHaveLength(1);
  });
});
