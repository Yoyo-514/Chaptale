import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';

import HistorySessionItem from '../components/HistorySessionItem.vue';
import HistoryToolbar from '../components/HistoryToolbar.vue';

function createSession(): ChaptaleSessionListItem {
  return {
    id: 'session-1',
    name: '第一章讨论',
    cwd: 'E:/novel',
    path: 'E:/novel/.chaptale/session.jsonl',
    messageCount: 6,
    lastMessagePreview: '继续完善这一章的冲突。',
    leafId: null,
    createdAt: '2026-07-04T00:00:00.000Z',
    updatedAt: '2026-07-04T08:05:00.000Z',
    scope: 'workspace',
    totalTokens: 12_300,
    totalCost: 0.12
  };
}

describe('history compact components', () => {
  it('uses concise controls with complete accessible labels', async () => {
    const wrapper = mount(HistoryToolbar, {
      props: {
        searchQuery: '',
        scopeFilter: 'all',
        sortMode: 'latest',
        isSelectionMode: false
      }
    });

    expect(wrapper.get('#history-title').text()).toBe('历史记录');
    expect(wrapper.get('input[aria-label="搜索历史记录"]').attributes('placeholder')).toBe('搜索历史记录...');
    expect(wrapper.get('button[aria-label="范围：全部"]').text()).toContain('范围');
    expect(wrapper.get('button[aria-label="排序：最新"]').text()).toContain('排序');

    await wrapper.get('button[aria-label="进入多选模式"]').trigger('click');

    expect(wrapper.emitted('toggleSelectionMode')).toEqual([[]]);
  });

  it('marks selection mode and keeps the compact session summary actionable', async () => {
    const session = createSession();
    const wrapper = mount(HistorySessionItem, {
      props: {
        session,
        isActive: true,
        isSelectionMode: true,
        isSelected: false
      },
      global: {
        stubs: {
          AppCheckbox: { template: '<button data-test="selection-checkbox" />' },
          SessionRenameDialog: true,
          HistoryDeleteSessionDialog: true
        }
      }
    });

    expect(wrapper.classes()).toContain('history-item-selection');
    expect(wrapper.find('.history-item-icon').exists()).toBe(false);
    expect(wrapper.get('.history-item-title').text()).toBe('第一章讨论');
    expect(wrapper.get('.history-item-stats').text()).toContain('12.3K token');

    await wrapper.get('.history-item-select').trigger('click');

    expect(wrapper.emitted('toggleSelect')).toEqual([['session-1']]);
    expect(wrapper.emitted('select')).toBeUndefined();
  });
});
