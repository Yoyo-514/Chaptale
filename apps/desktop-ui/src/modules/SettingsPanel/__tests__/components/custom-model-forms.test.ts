import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

import { AppCheckbox } from '@/components/AppCheckbox';
import { AppSelect } from '@/components/AppSelect';
import CustomModelDraftForm from '../../components/CustomModelDraftForm.vue';
import LlmAddCustomModelPanel from '../../components/LlmAddCustomModelPanel.vue';
import LlmCustomProviderForm from '../../components/LlmCustomProviderForm.vue';
import { createCustomModelDraft } from '../../utils/custom-model-draft.ts';

const AppDialogStub = defineComponent({
  props: {
    open: Boolean,
    title: String
  },
  emits: ['update:open'],
  setup(props, { emit, slots }) {
    return () =>
      props.open
        ? h('section', { class: 'app-dialog-stub' }, [
            h('h2', props.title),
            slots.default?.({ close: () => emit('update:open', false) })
          ])
        : null;
  }
});

const AppScrollAreaStub = defineComponent({
  setup(_, { slots }) {
    return () => h('div', { class: 'app-scroll-area-stub' }, slots.default?.());
  }
});

const dialogStubs = {
  AppDialog: AppDialogStub,
  AppScrollArea: AppScrollAreaStub
};

describe('custom model forms', () => {
  it('edits the shared model draft and selects fetched models', async () => {
    const draft = createCustomModelDraft();
    const wrapper = mount(CustomModelDraftForm, {
      props: {
        draft,
        fetchedModels: [{ id: 'model-a', name: 'Model A' }],
        isFetching: false,
        canFetch: true
      }
    });
    const inputs = wrapper.findAll('[data-slot="app-input-control"]');

    await inputs[0].setValue('manual-model');
    await inputs[1].setValue('Manual Model');
    await inputs[2].setValue('4096');
    expect(draft).toMatchObject({ modelId: 'manual-model', modelName: 'Manual Model', contextWindow: '4096' });

    wrapper.findComponent(AppCheckbox).vm.$emit('update:modelValue', true);
    expect(draft.supportsImageInput).toBe(true);

    wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 'model-a');
    await nextTick();
    expect(draft.modelId).toBe('model-a');
    expect(draft.modelName).toBe('Model A');

    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('fetch')).toHaveLength(1);
  });

  it('submits and closes the add-model dialog through AppForm actions', async () => {
    const wrapper = mount(LlmAddCustomModelPanel, {
      props: {
        open: true,
        title: '添加模型',
        submitLabel: '添加',
        draft: createCustomModelDraft(),
        fetchedModels: [],
        isFetching: false,
        canFetch: false,
        canSubmit: true
      },
      global: {
        stubs: dialogStubs
      }
    });

    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toHaveLength(1);

    const cancelButton = wrapper.findAll('button').find(button => button.text() === '取消');
    await cancelButton?.trigger('click');
    expect(wrapper.emitted('update:open')?.at(-1)?.[0]).toBe(false);
  });

  it('edits and submits a custom provider while preserving staged-model events', async () => {
    const provider = {
      provider: '',
      providerName: '',
      baseUrl: '',
      api: 'openai-completions' as const,
      apiKey: ''
    };
    const wrapper = mount(LlmCustomProviderForm, {
      props: {
        open: true,
        provider,
        draft: createCustomModelDraft(),
        stagedModels: [
          {
            modelId: 'model-a',
            modelName: 'Model A',
            input: ['text']
          }
        ],
        fetchedModels: [],
        isFetching: false,
        isLoading: false,
        canFetch: false,
        canStageModel: true,
        canSubmit: true
      },
      global: {
        stubs: dialogStubs
      }
    });

    await wrapper.get('input[name="provider"]').setValue('custom');
    await wrapper.get('input[name="providerName"]').setValue('Custom Provider');
    await wrapper.get('input[name="apiKey"]').setValue('sk-custom');
    await wrapper.get('input[name="baseUrl"]').setValue('https://api.example.com/v1');
    expect(provider).toMatchObject({
      provider: 'custom',
      providerName: 'Custom Provider',
      apiKey: 'sk-custom',
      baseUrl: 'https://api.example.com/v1'
    });

    const stageButton = wrapper.findAll('button').find(button => button.text() === '加入待添加列表');
    await stageButton?.trigger('click');
    expect(wrapper.emitted('stageModel')).toHaveLength(1);

    await wrapper.get('button[aria-label="移除待添加模型"]').trigger('click');
    expect(wrapper.emitted('removeStagedModel')?.[0]).toEqual(['model-a']);

    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toHaveLength(1);
  });
});
