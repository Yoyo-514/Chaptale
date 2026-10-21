import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it } from 'vitest';

import type { SessionUsage as Usage } from '@chaptale/agent-host/protocol';

import SessionUsage from '../components/SessionUsage.vue';

const usage: Usage = {
  input: 12000,
  cacheRead: 8000,
  cacheWrite: 0,
  output: 1500,
  context: { tokens: 32000, contextWindow: 100000, percent: 32 }
};
let wrapper: ReturnType<typeof mount>;
afterEach(() => {
  wrapper?.unmount();
});

it('上下文用约字提示估算，详情展示SDK记录的四项累计用量', async () => {
  wrapper = mount(SessionUsage, { props: { usage }, attachTo: document.body });
  expect(wrapper.get('button').text()).toBe('上下文约 32%');
  await wrapper.get('button').trigger('click');
  await flushPromises();
  const details = document.querySelector('[role="dialog"]')!;
  expect(details.textContent).toContain('本会话累计用量');
  expect([...details.querySelectorAll('dd')].map(item => item.textContent)).toEqual([
    '12,000',
    '8,000',
    '0',
    '1,500',
    '32,000 / 100,000'
  ]);
  expect(details.textContent).toContain('服务未报告的项目可能记为 0');
});

it('压缩后的未知上下文保留累计统计，取得新用量后恢复百分比', async () => {
  wrapper = mount(SessionUsage, {
    props: { usage: { ...usage, context: { tokens: null, percent: null, contextWindow: 100000 } } }
  });
  expect(wrapper.get('button').text()).toBe('上下文未知');
  await wrapper.setProps({ usage });
  expect(wrapper.get('button').text()).toBe('上下文约 32%');
  await wrapper.setProps({ usage: { ...usage, context: undefined } });
  expect(wrapper.get('button').text()).toBe('上下文未知');
});
