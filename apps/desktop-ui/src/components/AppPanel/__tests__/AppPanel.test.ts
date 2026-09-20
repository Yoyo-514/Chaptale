import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppPanel from '../AppPanel.vue';

describe('AppPanel', () => {
  it('按标题、筛选、内容和底部操作组织面板', () => {
    const wrapper = mount(AppPanel, {
      props: { title: '记录', count: 0, subtitle: '正文/第一章.md' },
      attrs: { 'aria-label': '运行记录' },
      slots: {
        actions: '<button>刷新</button>',
        toolbar: '<input aria-label="筛选记录" />',
        default: '<p>暂无记录</p>',
        footer: '<button>新建记录</button>'
      }
    });

    expect(wrapper.attributes('aria-label')).toBe('运行记录');
    expect(wrapper.get('h2').text()).toBe('记录');
    expect(wrapper.get('.app-panel-count').text()).toBe('0');
    expect(wrapper.get('.app-panel-subtitle').text()).toBe('正文/第一章.md');
    expect(wrapper.get('header button').text()).toBe('刷新');
    expect(wrapper.get('.app-panel-toolbar input').attributes('aria-label')).toBe('筛选记录');
    expect(wrapper.get('[data-slot="app-scroll-area"] p').text()).toBe('暂无记录');
    expect(wrapper.get('footer button').text()).toBe('新建记录');
    wrapper.unmount();
  });

  it('没有辅助槽位时不留下空工具栏和页脚', () => {
    const wrapper = mount(AppPanel, { props: { title: '参考' }, slots: { default: '正文' } });
    expect(wrapper.find('.app-panel-actions').exists()).toBe(false);
    expect(wrapper.find('.app-panel-toolbar').exists()).toBe(false);
    expect(wrapper.find('.app-panel-count').exists()).toBe(false);
    expect(wrapper.find('footer').exists()).toBe(false);
    wrapper.unmount();
  });

  it('标签页已命名面板时标题只留给读屏器，表头仅剩操作', () => {
    const wrapper = mount(AppPanel, {
      props: { title: '候选稿', count: 3, titleHidden: true },
      slots: { actions: '<button>刷新</button>', default: '列表' }
    });
    expect(wrapper.get('h2').classes()).toContain('sr-only');
    expect(wrapper.get('h2').text()).toBe('候选稿');
    expect(wrapper.find('.app-panel-count').exists()).toBe(false);
    expect(wrapper.get('header button').text()).toBe('刷新');
    wrapper.unmount();
  });

  it('标签页已命名且没有操作时只保留隐藏标题', () => {
    const wrapper = mount(AppPanel, { props: { title: '资产详情', titleHidden: true }, slots: { default: '内容' } });
    expect(wrapper.find('header').exists()).toBe(false);
    expect(wrapper.get('h2').text()).toBe('资产详情');
    wrapper.unmount();
  });
});
