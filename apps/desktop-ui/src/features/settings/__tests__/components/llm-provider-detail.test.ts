import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';

import LlmProviderDetail from '../../components/LlmProviderDetail.vue';
import type { ProviderView } from '../../utils/llm-settings.helpers';

const AppAlertDialogStub = defineComponent({
  props: {
    title: String,
    description: String,
    confirmLabel: String
  },
  emits: ['confirm'],
  setup(props, { emit, slots }) {
    return () =>
      h('div', { class: 'alert-dialog-stub' }, [
        slots.trigger?.(),
        h('button', { class: 'alert-confirm', onClick: () => emit('confirm') }, props.confirmLabel)
      ]);
  }
});

const AppScrollAreaStub = defineComponent({
  setup(_, { slots }) {
    return () => h('div', { class: 'app-scroll-area-stub' }, slots.default?.());
  }
});

function mountDetail() {
  const provider: ProviderView = {
    provider: 'openai',
    providerName: 'OpenAI',
    authConfigured: true,
    modelCount: 1
  };
  return mount(LlmProviderDetail, {
    props: {
      provider,
      apiKey: '',
      isApiKeySaving: false,
      apiKeyPlaceholder: 'sk-...',
      isModelsLoading: false,
      models: []
    },
    global: {
      stubs: {
        AppAlertDialog: AppAlertDialogStub,
        AppScrollArea: AppScrollAreaStub
      }
    }
  });
}

describe('LlmProviderDetail', () => {
  it('renders the provider identity and the remove provider entry', () => {
    const wrapper = mountDetail();

    expect(wrapper.get('h4').text()).toBe('OpenAI');
    expect(wrapper.text()).toContain('供应商 ID');
    expect(wrapper.findAll('button').some(button => button.text() === '删除供应商')).toBe(true);
  });

  it('emits removeProvider only after explicit confirmation', async () => {
    const wrapper = mountDetail();
    const removeButton = wrapper.findAll('button').find(button => button.text() === '删除供应商');

    // 未确认前不删除。
    await removeButton?.trigger('click');
    expect(wrapper.emitted('removeProvider')).toBeUndefined();

    await wrapper.find('.alert-confirm').trigger('click');
    expect(wrapper.emitted('removeProvider')?.[0]).toEqual(['openai']);
  });
});
