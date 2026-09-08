import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { formatTokenUsageDetails } from '@/utils/token-usage';

import AppUsageDetails from '../AppUsageDetails.vue';

describe('AppUsageDetails', () => {
  it('旧记录显示未返回，真实零值清楚展示', async () => {
    const wrapper = mount(AppUsageDetails, { props: { usage: { inputTokens: 100, outputTokens: 10 } } });
    expect(wrapper.findAll('dd').map(node => node.text())).toEqual([
      '100 tokens',
      '10 tokens',
      '未返回',
      '未返回',
      '未返回'
    ]);
    await wrapper.setProps({ usage: { inputTokens: 100, outputTokens: 10, cache: { readTokens: 0 } } });
    expect(wrapper.findAll('dd')[2]!.text()).toBe('0 tokens');
    wrapper.unmount();
  });

  it('显示分项并标注部分用量，消息提示与面板使用相同口径', () => {
    const usage = {
      inputTokens: 100,
      outputTokens: 10,
      cache: { readTokens: 50, writeTokens: 20, uncachedTokens: 30, partial: true }
    };
    const wrapper = mount(AppUsageDetails, { props: { usage } });
    expect(wrapper.find('[role="status"]').text()).toContain('已报告部分');
    expect(formatTokenUsageDetails(usage)).toContain('缓存读取：50 tokens');
    expect(formatTokenUsageDetails(usage)).toContain('已报告部分');
    wrapper.unmount();
  });
});
