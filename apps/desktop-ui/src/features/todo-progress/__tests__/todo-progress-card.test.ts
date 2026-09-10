import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';

import type { TodoItem } from '@chaptale/shared';

import TodoProgressCard from '../components/TodoProgressCard.vue';

const AppAlertDialogStub = defineComponent({
  props: {
    title: String,
    description: String,
    confirmLabel: String
  },
  emits: ['confirm'],
  setup(props, { emit, slots }) {
    return () =>
      h('div', { class: 'alert-dialog-stub' }, [
        slots.trigger?.(),
        h('button', { class: 'alert-confirm', onClick: () => emit('confirm') }, props.confirmLabel)
      ]);
  }
});

const AppCollapsibleStub = defineComponent({
  props: {
    modelValue: Boolean
  },
  emits: ['update:modelValue'],
  setup(props, { slots }) {
    return () =>
      h('div', { class: 'collapsible-stub' }, [slots.trigger?.({ open: props.modelValue }), slots.default?.()]);
  }
});

const AppScrollAreaStub = defineComponent({
  setup(_, { slots }) {
    return () => h('div', { class: 'scroll-area-stub' }, slots.default?.());
  }
});

function createItems(): TodoItem[] {
  return [
    { id: '1', content: '已完成任务', status: 'completed' },
    { id: '2', content: '进行中任务', status: 'in_progress' },
    { id: '3', content: '待办任务', status: 'pending' }
  ];
}

function mountCard(overrides?: { isClearing?: boolean; completedCount?: number; total?: number }) {
  const items = createItems();
  return mount(TodoProgressCard, {
    props: {
      items,
      total: overrides?.total ?? items.length,
      completedCount: overrides?.completedCount ?? 1,
      isClearing: overrides?.isClearing ?? false
    },
    global: {
      stubs: {
        AppAlertDialog: AppAlertDialogStub,
        AppCollapsible: AppCollapsibleStub,
        AppScrollArea: AppScrollAreaStub
      }
    }
  });
}

describe('TodoProgressCard', () => {
  it('renders clear actions and disables clearing completed when none exist', () => {
    const wrapper = mountCard({ completedCount: 0 });

    const clearCompleted = wrapper.findAll('button').find(button => button.text() === '清空已完成');
    const clearAll = wrapper.findAll('button').find(button => button.text() === '清空全部');
    expect(clearCompleted).toBeTruthy();
    expect(clearAll).toBeTruthy();
    expect(clearCompleted?.attributes()).toHaveProperty('disabled');
    expect(clearAll?.attributes()).not.toHaveProperty('disabled');
  });

  it('emits clearCompleted when the action is clicked', async () => {
    const wrapper = mountCard();
    const clearCompleted = wrapper.findAll('button').find(button => button.text() === '清空已完成');

    await clearCompleted?.trigger('click');

    expect(wrapper.emitted('clearCompleted')).toHaveLength(1);
    expect(wrapper.emitted('clearAll')).toBeUndefined();
  });

  it('emits clearAll only after alert dialog confirmation', async () => {
    const wrapper = mountCard();
    const clearAllTrigger = wrapper.findAll('button').find(button => button.text() === '清空全部');

    // 触发按钮本身只打开确认弹窗，不直接清空。
    await clearAllTrigger?.trigger('click');
    expect(wrapper.emitted('clearAll')).toBeUndefined();

    await wrapper.find('.alert-confirm').trigger('click');
    expect(wrapper.emitted('clearAll')).toHaveLength(1);
  });

  it('disables both actions while a clear is in flight', () => {
    const wrapper = mountCard({ isClearing: true });

    for (const label of ['清空已完成', '清空全部']) {
      const button = wrapper.findAll('button').find(candidate => candidate.text() === label);
      expect(button?.attributes()).toHaveProperty('disabled');
    }
  });
});
