import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ContextPressureCard from '../../components/ContextPressureCard.vue';

const status = {
  tokens: 72_000,
  contextWindow: 100_000,
  percent: 72,
  thresholdPercent: 70,
  shouldPrompt: true
};

describe('ContextPressureCard', () => {
  it('shows context pressure and lets the author confirm or defer compaction', async () => {
    const wrapper = mount(ContextPressureCard, { props: { status, isCompacting: false } });

    expect(wrapper.text()).toContain('72%');
    expect(wrapper.text()).toContain('压缩');

    const compactButton = wrapper.findAll('button').find(button => button.text() === '压缩后继续');
    const deferButton = wrapper.findAll('button').find(button => button.text() === '稍后');
    await compactButton?.trigger('click');
    await deferButton?.trigger('click');

    expect(wrapper.emitted('compact')).toHaveLength(1);
    expect(wrapper.emitted('dismiss')).toHaveLength(1);
  });

  it('disables actions while compaction is running', () => {
    const wrapper = mount(ContextPressureCard, { props: { status, isCompacting: true } });
    const buttons = wrapper.findAll('button');

    expect(wrapper.text()).toContain('正在压缩');
    expect(buttons.every(button => button.attributes('disabled') !== undefined)).toBe(true);
  });
});
