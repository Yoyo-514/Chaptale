import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import NotificationCenterItem from '../../components/NotificationCenterItem.vue';

const notification = {
  id: 7,
  kind: 'error' as const,
  title: '保存失败',
  description: '无法写入当前文件，请检查文件权限。',
  createdAt: new Date('2026-07-12T08:05:00Z').getTime()
};

describe('NotificationCenterItem', () => {
  it('uses a VS Code-like main, description, and details row layout', () => {
    const wrapper = mount(NotificationCenterItem, {
      props: { notification, mode: 'manual' }
    });

    expect(wrapper.classes()).toContain('is-manual');

    const mainRow = wrapper.get('.notification-item-main-row');
    expect(mainRow.find('.notification-item-icon').exists()).toBe(true);
    expect(mainRow.get('.notification-item-title').text()).toBe('保存失败');
    expect(mainRow.get('.notification-item-toolbar').get('button').attributes('aria-label')).toBe('移除通知');

    expect(wrapper.get('.notification-item-description').text()).toBe('无法写入当前文件，请检查文件权限。');
    const time = wrapper.get('.notification-item-details-row time');
    expect(time.attributes('datetime')).toBe('2026-07-12T08:05:00.000Z');
    expect(time.text()).not.toBe('');
  });

  it('keeps the details row when no description is provided and emits dismiss from the toolbar', async () => {
    const wrapper = mount(NotificationCenterItem, {
      props: {
        notification: {
          ...notification,
          description: undefined
        },
        mode: 'auto'
      }
    });

    expect(wrapper.classes()).toContain('is-auto');
    expect(wrapper.find('.notification-item-description').exists()).toBe(false);
    expect(wrapper.find('.notification-item-details-row').exists()).toBe(true);

    await wrapper.get('.notification-item-toolbar button').trigger('click');
    expect(wrapper.emitted('dismiss')).toEqual([[7]]);
  });
});
