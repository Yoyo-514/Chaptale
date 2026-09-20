import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppPanelSection from '../AppPanelSection.vue';

describe('AppPanelSection', () => {
  it('渲染可折叠分节头、计数与内容，并回报展开状态', async () => {
    const wrapper = mount(AppPanelSection, {
      props: { title: '观察笔记', count: 2 },
      slots: { default: '<p>条目</p>', actions: '<button>新建</button>' }
    });
    const details = wrapper.get('details');
    expect(details.attributes('open')).toBeDefined();
    expect(wrapper.get('.app-panel-section-title').text()).toBe('观察笔记');
    expect(wrapper.get('.app-panel-section-count').text()).toBe('2');
    expect(wrapper.get('summary button').text()).toBe('新建');
    expect(wrapper.get('.app-panel-section-body p').text()).toBe('条目');
    (details.element as HTMLDetailsElement).open = false;
    await details.trigger('toggle');
    expect(wrapper.emitted('toggle')?.at(-1)).toEqual([false]);
    wrapper.unmount();
  });

  it('可默认折叠，叙述性分节用 h3 标题', () => {
    const wrapper = mount(AppPanelSection, { props: { title: '索引诊断', open: false, heading: true } });
    expect(wrapper.get('details').attributes('open')).toBeUndefined();
    expect(wrapper.get('h3').text()).toBe('索引诊断');
    expect(wrapper.find('.app-panel-section-count').exists()).toBe(false);
    wrapper.unmount();
  });
});
