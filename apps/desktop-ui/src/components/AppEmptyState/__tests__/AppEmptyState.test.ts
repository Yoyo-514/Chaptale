import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppEmptyState from '../AppEmptyState.vue';

describe('AppEmptyState', () => {
  it('以状态区展示标题、说明与操作', () => {
    const wrapper = mount(AppEmptyState, {
      props: { title: '还没有候选稿', description: '先组装参考，再生成候选。', icon: 'i-mingcute-quill-pen-line' },
      slots: { default: '<button>生成候选稿</button>' }
    });
    expect(wrapper.attributes('role')).toBe('status');
    expect(wrapper.get('.app-empty-state-title').text()).toBe('还没有候选稿');
    expect(wrapper.get('.app-empty-state-description').text()).toBe('先组装参考，再生成候选。');
    expect(wrapper.get('.app-empty-state-icon').classes()).toContain('i-mingcute-quill-pen-line');
    expect(wrapper.get('.app-empty-state-actions button').text()).toBe('生成候选稿');
    wrapper.unmount();
  });

  it('没有说明和操作时不渲染空容器', () => {
    const wrapper = mount(AppEmptyState, { props: { title: '没有匹配资产' } });
    expect(wrapper.find('.app-empty-state-description').exists()).toBe(false);
    expect(wrapper.find('.app-empty-state-actions').exists()).toBe(false);
    expect(wrapper.find('.app-empty-state-icon').exists()).toBe(false);
    wrapper.unmount();
  });
});
