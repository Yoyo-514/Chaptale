import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import LlmProviderAuthPanel from '../../components/LlmProviderAuthPanel.vue';

function mountPanel(overrides?: { apiKey?: string; isSaving?: boolean; canRemove?: boolean }) {
  return mount(LlmProviderAuthPanel, {
    props: {
      apiKey: overrides?.apiKey ?? '',
      isSaving: overrides?.isSaving ?? false,
      canRemove: overrides?.canRemove ?? false,
      placeholder: 'sk-...'
    }
  });
}

describe('LlmProviderAuthPanel', () => {
  it('updates the API Key through AppInput', async () => {
    const wrapper = mountPanel();

    await wrapper.find('input').setValue('sk-test');

    expect(wrapper.emitted('update:apiKey')?.at(-1)?.[0]).toBe('sk-test');
    expect(wrapper.find('label').text()).toContain('API Key');
  });

  it('submits through native form semantics', async () => {
    const wrapper = mountPanel();

    await wrapper.find('form').trigger('submit');

    expect(wrapper.emitted('submit')).toHaveLength(1);
    expect(wrapper.find('button[type="submit"]').text()).toBe('保存 API Key');
  });

  it('disables controls and shows saving state while submitting', () => {
    const wrapper = mountPanel({ isSaving: true, canRemove: true });

    expect(wrapper.find('input').attributes()).toHaveProperty('disabled');
    expect(wrapper.find('button[type="submit"]').attributes()).toHaveProperty('disabled');
    expect(wrapper.find('button[type="submit"]').text()).toBe('保存中...');
  });

  it('disables API Key removal when no key is configured', () => {
    const wrapper = mountPanel({ canRemove: false });
    const removeButton = wrapper.findAll('button').find(button => button.text() === '移除 API Key');

    expect(removeButton?.attributes()).toHaveProperty('disabled');
  });

  it('allows API Key removal when a key is configured', () => {
    const wrapper = mountPanel({ canRemove: true });
    const removeButton = wrapper.findAll('button').find(button => button.text() === '移除 API Key');

    expect(removeButton?.attributes()).not.toHaveProperty('disabled');
  });
});
