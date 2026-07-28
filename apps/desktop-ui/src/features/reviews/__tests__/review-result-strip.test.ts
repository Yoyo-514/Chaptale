import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import ReviewResultStrip from '../components/ReviewResultStrip.vue';
import type { ReviewLaneKey, ReviewLaneState } from '../index';

function lane(overrides: Partial<ReviewLaneState> & Pick<ReviewLaneState, 'key'>): ReviewLaneState {
  const base = {
    continuity: {
      personaId: 'continuity-reviewer',
      agentType: 'continuity',
      brief: '审查以下文本的连贯性问题'
    },
    character: {
      personaId: 'character-reviewer',
      agentType: 'character',
      brief: '审查以下文本的人物一致性问题'
    },
    style: {
      personaId: 'style-reviewer',
      agentType: 'style',
      brief: '审查以下文本的文风与节奏问题'
    }
  }[overrides.key];

  return {
    ...base,
    status: 'idle',
    requestId: null,
    runId: null,
    outputRef: null,
    result: null,
    errors: [],
    submittedText: undefined,
    operationToken: 0,
    ...overrides,
    key: overrides.key
  } as ReviewLaneState;
}

function mountStrip(lanes: ReviewLaneState[]) {
  return mount(ReviewResultStrip, {
    attachTo: document.body,
    props: { lanes },
    global: {
      stubs: {
        AppScrollArea: { template: '<div><slot /></div>' }
      }
    }
  });
}

describe('ReviewResultStrip', () => {
  it('显示三路 Tab 的独立状态，切换只改变可见 lane 内容', async () => {
    const lanes = [
      lane({
        key: 'continuity',
        status: 'done',
        submittedText: '原文已经被改动',
        result: {
          summary: '连贯性摘要',
          issues: [
            {
              agentType: 'continuity',
              severity: 'high',
              type: 'timeline',
              quote: '旧句子',
              reason: '时间线前后冲突',
              suggestion: '调整事件顺序'
            }
          ]
        }
      }),
      lane({ key: 'character', status: 'failed', errors: ['人物审查失败'] }),
      lane({
        key: 'style',
        status: 'read-failed',
        errors: ['结果文件不可读'],
        runId: 'run-style',
        outputRef: 'ref-style'
      })
    ];
    const originalStatuses = lanes.map(item => item.status);
    const wrapper = mountStrip(lanes);

    const tabs = wrapper.findAll('.review-lane-tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]?.text()).toContain('连贯性');
    expect(tabs[0]?.text()).toContain('1');
    expect(tabs[1]?.text()).toContain('人物');
    expect(tabs[1]?.text()).toContain('错误');
    expect(tabs[2]?.text()).toContain('文风');
    expect(tabs[2]?.text()).toContain('错误');

    expect(wrapper.text()).toContain('连贯性摘要');
    expect(wrapper.text()).toContain('timeline');
    expect(wrapper.text()).toContain('旧句子');
    expect(wrapper.text()).toContain('时间线前后冲突');
    expect(wrapper.text()).toContain('调整事件顺序');
    expect(wrapper.text()).toContain('原文已变化');
    expect(wrapper.text()).not.toContain('人物审查失败');
    expect(wrapper.text()).not.toContain('重试读取');
    expect(wrapper.find('button[aria-label*="跳转"]').exists()).toBe(false);

    await tabs[1]?.trigger('click');
    expect(lanes.map(item => item.status)).toEqual(originalStatuses);
    expect(wrapper.text()).toContain('人物审查失败');
    expect(wrapper.text()).not.toContain('连贯性摘要');
    expect(wrapper.text()).not.toContain('结果文件不可读');

    await tabs[2]?.trigger('click');
    expect(wrapper.text()).toContain('结果文件不可读');
    expect(wrapper.text()).toContain('重试读取');
    expect(wrapper.text()).not.toContain('人物审查失败');

    wrapper.unmount();
  });

  it('为 tabs 和 panel 建立稳定的 ARIA 关系与 roving tabindex', () => {
    const wrapper = mountStrip([
      lane({ key: 'continuity', status: 'done', result: { summary: '连贯摘要', issues: [] } }),
      lane({ key: 'character', status: 'failed', errors: ['人物审查失败'] }),
      lane({ key: 'style', status: 'read-failed', errors: ['结果文件不可读'] })
    ]);

    const tabs = wrapper.findAll('.review-lane-tab');
    const panel = wrapper.get('[role="tabpanel"]');

    expect(tabs[0]?.attributes('id')).toBe('reviews-tab-continuity');
    expect(tabs[0]?.attributes('aria-controls')).toBe('reviews-panel-continuity');
    expect(tabs[0]?.attributes('aria-selected')).toBe('true');
    expect(tabs[0]?.attributes('tabindex')).toBe('0');
    expect(tabs[1]?.attributes('id')).toBe('reviews-tab-character');
    expect(tabs[1]?.attributes('aria-controls')).toBe('reviews-panel-character');
    expect(tabs[1]?.attributes('aria-selected')).toBe('false');
    expect(tabs[1]?.attributes('tabindex')).toBe('-1');
    expect(tabs[2]?.attributes('id')).toBe('reviews-tab-style');
    expect(tabs[2]?.attributes('aria-controls')).toBe('reviews-panel-style');
    expect(tabs[2]?.attributes('aria-selected')).toBe('false');
    expect(tabs[2]?.attributes('tabindex')).toBe('-1');
    expect(panel.attributes('id')).toBe('reviews-panel-continuity');
    expect(panel.attributes('aria-labelledby')).toBe('reviews-tab-continuity');

    wrapper.unmount();
  });

  it('支持 ArrowLeft/Right 与 Home/End 键盘切换，并把焦点移到新激活 tab', async () => {
    const wrapper = mountStrip([
      lane({ key: 'continuity', status: 'done', result: { summary: '连贯摘要', issues: [] } }),
      lane({ key: 'character', status: 'done', result: { summary: '人物摘要', issues: [] } }),
      lane({ key: 'style', status: 'done', result: { summary: '文风摘要', issues: [] } })
    ]);
    const tabs = () => wrapper.findAll<HTMLButtonElement>('.review-lane-tab');

    tabs()[0]?.element.focus();
    expect(document.activeElement).toBe(tabs()[0]?.element);

    await tabs()[0]?.trigger('keydown', { key: 'ArrowRight' });
    await nextTick();
    expect(tabs()[1]?.attributes('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs()[1]?.element);

    await tabs()[1]?.trigger('keydown', { key: 'End' });
    await nextTick();
    expect(tabs()[2]?.attributes('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs()[2]?.element);

    await tabs()[2]?.trigger('keydown', { key: 'Home' });
    await nextTick();
    expect(tabs()[0]?.attributes('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs()[0]?.element);

    await tabs()[0]?.trigger('keydown', { key: 'ArrowLeft' });
    await nextTick();
    expect(tabs()[2]?.attributes('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs()[2]?.element);

    wrapper.unmount();
  });

  it('按 lane 类型展示 issue 扩展字段且不出现处理或改写控件', async () => {
    const wrapper = mountStrip([
      lane({ key: 'continuity', status: 'idle' }),
      lane({
        key: 'character',
        status: 'done',
        result: {
          summary: '人物摘要',
          issues: [
            {
              agentType: 'character',
              severity: 'medium',
              type: 'ooc',
              quote: '他突然大笑',
              reason: '角色此前一直克制',
              suggestion: '补足情绪铺垫',
              expectedBehavior: '保持克制'
            }
          ]
        }
      }),
      lane({
        key: 'style',
        status: 'done',
        result: {
          summary: '文风摘要',
          issues: [
            {
              agentType: 'style',
              severity: 'low',
              type: 'flat_rhythm',
              quote: '他走了。他停下。',
              reason: '句式节奏单一',
              suggestion: '调整长短句',
              rewriteSuggestion: '把动作拆开写'
            }
          ]
        }
      })
    ]);

    expect(wrapper.text()).toContain('人物摘要');
    expect(wrapper.text()).toContain('expectedBehavior');
    expect(wrapper.text()).toContain('保持克制');

    await wrapper.findAll('.review-lane-tab')[2]?.trigger('click');
    expect(wrapper.text()).toContain('文风摘要');
    expect(wrapper.text()).toContain('把动作拆开写');

    const forbiddenWords = [
      '\u8fc7\u6ee4',
      '\u5904\u7406',
      '\u5ffd\u7565',
      '\u6279\u91cf',
      String.fromCharCode(101, 100, 105, 116, 111, 114),
      String.fromCharCode(68, 101, 99, 111, 114, 97, 116, 105, 111, 110)
    ];
    for (const word of forbiddenWords) {
      expect(wrapper.text()).not.toContain(word);
      expect(wrapper.html()).not.toContain(word);
    }

    wrapper.unmount();
  });

  it('每路取消、重试读取和关闭只 emit 对应 lane key', async () => {
    const wrapper = mountStrip([
      lane({ key: 'continuity', status: 'done', result: { summary: '连贯摘要', issues: [] } }),
      lane({ key: 'character', status: 'running', requestId: 'req-character' }),
      lane({ key: 'style', status: 'read-failed', runId: 'run-style', outputRef: 'ref-style', errors: ['读取失败'] })
    ]);

    await wrapper.find('button[aria-label="关闭连贯性结果"]').trigger('click');
    expect(wrapper.emitted<ReviewLaneKey[]>('dismiss')).toEqual([['continuity']]);

    await wrapper.findAll('.review-lane-tab')[1]?.trigger('click');
    expect(wrapper.text()).toContain('正在审查人物');
    await wrapper.find('button[aria-label="取消人物审查"]').trigger('click');
    expect(wrapper.emitted<ReviewLaneKey[]>('cancel')).toEqual([['character']]);

    await wrapper.findAll('.review-lane-tab')[2]?.trigger('click');
    await wrapper.find('button[aria-label="重试读取文风结果"]').trigger('click');
    expect(wrapper.emitted<ReviewLaneKey[]>('retryRead')).toEqual([['style']]);

    wrapper.unmount();
  });

  it('全部 lanes 重置为 idle 时不再渲染结果条', async () => {
    const wrapper = mountStrip([
      lane({ key: 'continuity', status: 'done', result: { summary: '连贯摘要', issues: [] } }),
      lane({ key: 'character', status: 'idle' }),
      lane({ key: 'style', status: 'idle' })
    ]);

    expect(wrapper.find('section[aria-label="三维审查结果"]').exists()).toBe(true);

    await wrapper.setProps({
      lanes: [
        lane({ key: 'continuity', status: 'idle' }),
        lane({ key: 'character', status: 'idle' }),
        lane({ key: 'style', status: 'idle' })
      ]
    });

    expect(wrapper.find('section[aria-label="三维审查结果"]').exists()).toBe(false);

    wrapper.unmount();
  });
});
