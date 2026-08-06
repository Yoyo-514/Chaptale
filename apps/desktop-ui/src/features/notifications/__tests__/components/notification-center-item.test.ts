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

    // 图标是 aria-hidden 装饰，不参与行为断言；title/描述/时间都是用户可见内容。
    expect(wrapper.text()).toContain('保存失败');
    expect(wrapper.find('button[aria-label="移除通知"]').exists()).toBe(true);

    expect(wrapper.text()).toContain('无法写入当前文件，请检查文件权限。');
    const time = wrapper.get('time');
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
    expect(wrapper.text()).not.toContain('无法写入当前文件，请检查文件权限。');
    // 无描述时仍保留 details 行（时间戳）。
    expect(wrapper.find('time').exists()).toBe(true);

    await wrapper.get('button[aria-label="移除通知"]').trigger('click');
    expect(wrapper.emitted('dismiss')).toEqual([[7]]);
  });
});
