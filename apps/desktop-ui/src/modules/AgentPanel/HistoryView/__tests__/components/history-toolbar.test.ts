import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { AppInput } from '@/components/AppInput';
import { AppSelect } from '@/components/AppSelect';
import HistoryToolbar from '../../components/HistoryToolbar.vue';

function mountToolbar(searchQuery = '') {
  return mount(HistoryToolbar, {
    props: {
      isSelectionMode: false,
      searchQuery,
      scopeFilter: 'all',
      sortMode: 'latest'
    }
  });
}

describe('HistoryToolbar', () => {
  it('uses AppInput for search and emits model updates', async () => {
    const wrapper = mountToolbar();
    const input = wrapper.findComponent(AppInput);

    await input.find('input').setValue('测试会话');

    expect(wrapper.emitted('update:searchQuery')?.at(-1)?.[0]).toBe('测试会话');
    expect(input.attributes('aria-label')).toBeUndefined();
    expect(input.find('input').attributes('aria-label')).toBe('搜索历史记录');
  });

  it('clears an existing search query', async () => {
    const wrapper = mountToolbar('已有搜索');

    await wrapper.get('button[aria-label="清空搜索"]').trigger('click');

    expect(wrapper.emitted('update:searchQuery')?.at(-1)?.[0]).toBe('');
  });

  it('updates scope and sort models through AppSelect', () => {
    const wrapper = mountToolbar();
    const selects = wrapper.findAllComponents(AppSelect);

    selects[0]!.vm.$emit('update:modelValue', 'workspace');
    selects[1]!.vm.$emit('update:modelValue', 'oldest');

    expect(wrapper.emitted('update:scopeFilter')?.at(-1)?.[0]).toBe('workspace');
    expect(wrapper.emitted('update:sortMode')?.at(-1)?.[0]).toBe('oldest');
  });
});
