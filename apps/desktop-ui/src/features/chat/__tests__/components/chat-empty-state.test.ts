import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ChatEmptyState from '../../components/ChatEmptyState.vue';

function mountEmptyState(props?: Partial<InstanceType<typeof ChatEmptyState>['$props']>) {
  return mount(ChatEmptyState, { props: { recentSessions: [], showConcepts: true, ...props } });
}

describe('聊天空态', () => {
  it('刚开始时说明专员的分工，避免只看到一句「今天想写什么」', () => {
    const wrapper = mountEmptyState();
    expect(wrapper.text()).toContain('每个会话由一位专员负责');
    expect(wrapper.text()).toContain('故事策划');
    expect(wrapper.text()).toContain('审查专员');
  });
  it('开始过之后不再重读概念说明', () => {
    expect(mountEmptyState({ showConcepts: false }).find('.chat-empty-concepts').exists()).toBe(false);
  });
  it('有最近任务时仍然列出会话', () => {
    const wrapper = mountEmptyState({
      recentSessions: [
        {
          id: 's1',
          name: '理清这个故事',
          createdAt: new Date(2026, 0, 2, 10, 0).toISOString(),
          updatedAt: new Date(2026, 0, 2, 10, 30).toISOString(),
          cwd: 'C:/chaptale/global',
          path: 'C:/chaptale/global/s1.jsonl',
          leafId: null,
          messageCount: 2,
          scope: 'global',
          totalTokens: 0
        }
      ]
    });
    expect(wrapper.text()).toContain('理清这个故事');
    expect(wrapper.text()).toContain('最近任务');
  });
});
