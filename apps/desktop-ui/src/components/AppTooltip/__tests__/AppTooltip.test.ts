import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { h, nextTick } from 'vue';

import AppTooltip from '../AppTooltip.vue';

function mountTooltip(text: string | undefined) {
  return mount(AppTooltip, {
    props: { text },
    slots: { default: () => h('button', { type: 'button' }, '接受') },
    attachTo: document.body
  });
}

/** 键盘聚焦立即弹出，不经过悬停延迟。触发节点就是插槽里的按钮本身。 */
async function focusByKeyboard() {
  const button = document.body.querySelector('button')!;
  // 测试环境里派发的 focus 不会命中 :focus-visible，这里代表“焦点来自键盘”。
  vi.spyOn(button, 'matches').mockReturnValue(true);
  button.dispatchEvent(new FocusEvent('focus'));
  await nextTick();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AppTooltip', () => {
  it('键盘聚焦触发节点时显示文字', async () => {
    const wrapper = mountTooltip('请先处理冲突');

    await focusByKeyboard();

    expect(document.body.querySelector('[data-slot="app-tooltip-content"]')?.textContent).toContain('请先处理冲突');
    wrapper.unmount();
  });

  it('没有文字时不弹出', async () => {
    const wrapper = mountTooltip(undefined);

    await focusByKeyboard();

    expect(document.body.querySelector('[data-slot="app-tooltip-content"]')).toBeNull();
    wrapper.unmount();
  });
});
