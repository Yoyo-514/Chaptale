import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppListItem from '../AppListItem.vue';

describe('AppListItem', () => {
  it('使用原生按钮事件并显示完整内容', async () => {
    let clicks = 0;
    const wrapper = mount(AppListItem, {
      props: { title: '正文/很长的章节名称.md', description: '待处理', meta: '2026/09/16', selected: true },
      attrs: {
        onClick: () => {
          clicks += 1;
        }
      }
    });
    await wrapper.trigger('click');
    expect(clicks).toBe(1);
    expect(wrapper.element.tagName).toBe('BUTTON');
    expect(wrapper.get('strong').text()).toBe('正文/很长的章节名称.md');
    expect(wrapper.get('.app-list-item-description').text()).toBe('待处理');
    expect(wrapper.get('small').text()).toBe('2026/09/16');
    expect(wrapper.classes()).toContain('app-button-selected');
    wrapper.unmount();
  });

  it('支持禁用和无附加信息的项目', () => {
    const wrapper = mount(AppListItem, { props: { title: '空文档' }, attrs: { disabled: true } });
    expect(wrapper.attributes('disabled')).toBeDefined();
    expect(wrapper.find('.app-list-item-description').exists()).toBe(false);
    expect(wrapper.find('.app-list-item-meta').exists()).toBe(false);
    wrapper.unmount();
  });

  it('密排模式只保留标题与元信息，与目录树同高', () => {
    const wrapper = mount(AppListItem, {
      props: { title: '林晚', description: '不该显示', meta: '角色', dense: true },
      slots: { leading: '<span class="icon" />', trailing: '<span class="warn" />' }
    });
    expect(wrapper.classes()).toContain('is-dense');
    expect(wrapper.find('.app-list-item-description').exists()).toBe(false);
    expect(wrapper.get('small').text()).toBe('角色');
    expect(wrapper.find('.app-list-item-leading .icon').exists()).toBe(true);
    expect(wrapper.find('.app-list-item-trailing .warn').exists()).toBe(true);
    wrapper.unmount();
  });
});
