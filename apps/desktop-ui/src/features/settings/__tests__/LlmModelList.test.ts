import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { ChaptaleModelInfo } from '@chaptale/ipc-contract';

import LlmModelList from '../components/LlmModelList.vue';

const model: ChaptaleModelInfo = {
  id: 'draft-model',
  name: 'Writing model',
  provider: 'author',
  providerName: 'Author',
  input: ['text'],
  contextWindow: 32_000,
  reasoning: false,
  isCustom: true,
  authConfigured: false,
  isDefault: false
};

describe('模型列表操作', () => {
  it('子按钮的键盘操作不切换默认模型，行本身仍可用键盘选择', async () => {
    const wrapper = mount(LlmModelList, { props: { models: [model], isLoading: false } });
    try {
      const edit = wrapper.get('[aria-label="编辑自定义模型"]');
      await edit.trigger('keydown', { key: 'Enter' });
      await edit.trigger('keydown', { key: ' ' });
      expect(wrapper.emitted('setDefault')).toBeUndefined();
      await edit.trigger('click');
      expect(wrapper.emitted('editCustomModel')).toEqual([[model]]);
      expect(wrapper.emitted('setDefault')).toBeUndefined();
      await wrapper.get('article').trigger('keydown', { key: 'Enter' });
      await wrapper.get('article').trigger('keydown', { key: ' ' });
      expect(wrapper.emitted('setDefault')).toEqual([
        ['author', 'draft-model'],
        ['author', 'draft-model']
      ]);
    } finally {
      wrapper.unmount();
    }
  });
});
