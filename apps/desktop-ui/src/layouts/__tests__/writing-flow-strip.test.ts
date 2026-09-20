import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useSettlementStore } from '@/features/settlement';
import { useWorkbenchStore } from '@/features/workbench';
import { useWritingStore } from '@/features/writing';

import WritingFlowStrip from '../WritingFlowStrip.vue';

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('WritingFlowStrip', () => {
  it('没有打开正文时四步都是空闲态，当前辅助视图标记为当前步骤', () => {
    const navigation = useWorkbenchStore();
    navigation.auxiliary = 'review';
    const wrapper = mount(WritingFlowStrip);
    const steps = wrapper.findAll('button');
    expect(steps.map(step => step.get('.writing-flow-label').text())).toEqual(['参考', '候选', '审查', '结算']);
    expect(steps.map(step => step.get('.writing-flow-status').text())).toEqual(['未组装', '暂无', '未审查', '未结算']);
    expect(steps[2]!.attributes('aria-current')).toBe('step');
    expect(steps[0]!.attributes('aria-current')).toBeUndefined();
    expect(steps[0]!.attributes('title')).toBe('参考：请先打开正文');
    wrapper.unmount();
  });

  it('点击步骤切换到对应辅助视图，运行中与待处理状态优先显示', async () => {
    const navigation = useWorkbenchStore();
    const writing = useWritingStore();
    const settlement = useSettlementStore();
    writing.running = ['job-1'];
    settlement.batches = [
      {
        id: 'b1',
        chapterPath: '正文/第一章.md',
        chapterTitle: '第一章',
        status: 'ready',
        pending: 3,
        targets: [],
        createdAt: '',
        updatedAt: ''
      } as never
    ];
    const wrapper = mount(WritingFlowStrip);
    const steps = wrapper.findAll('button');
    expect(steps[1]!.get('.writing-flow-status').text()).toBe('生成中');
    expect(steps[1]!.classes()).toContain('is-busy');
    // 没有打开该章节时，结算待确认不计入当前章。
    expect(steps[3]!.get('.writing-flow-status').text()).toBe('未结算');
    await steps[3]!.trigger('click');
    expect(navigation.auxiliary).toBe('settlement');
    expect(navigation.auxiliaryOpen).toBe(true);
    wrapper.unmount();
  });
});
