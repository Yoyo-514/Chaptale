import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import AppDialog from '../AppDialog.vue';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AppDialog 无障碍描述', () => {
  it('没有描述时保留标题，不引用不存在的描述节点', async () => {
    const wrapper = mount(AppDialog, { attachTo: document.body, props: { open: true, title: '文件与同步' } });
    await nextTick();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('文件与同步');
    expect(dialog.hasAttribute('aria-describedby')).toBe(false);
    wrapper.unmount();
  });
  it('描述变更后更新关联，移除描述不留下失效 id', async () => {
    const wrapper = mount(AppDialog, {
      attachTo: document.body,
      props: { open: true, title: '删除内容', description: '无法恢复' }
    });
    await nextTick();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe('无法恢复');
    await wrapper.setProps({ description: undefined });
    expect(dialog.hasAttribute('aria-describedby')).toBe(false);
    await wrapper.setProps({ description: '保留文件' });
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe('保留文件');
    wrapper.unmount();
  });
  it('描述插槽仍有可解析的关联', async () => {
    const wrapper = mount(AppDialog, {
      attachTo: document.body,
      props: { open: true, title: '预览' },
      slots: { description: '完整删除范围' }
    });
    await nextTick();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe('完整删除范围');
    wrapper.unmount();
  });
});
