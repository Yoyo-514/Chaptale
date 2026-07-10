import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SessionRenameDialog from '../components/SessionRenameDialog.vue';

function createSession(overrides = {}) {
  return {
    id: 'session-1',
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    cwd: 'E:/backend-study/Chaptale',
    path: 'session-1.jsonl',
    leafId: null,
    name: '旧名字',
    messageCount: 1,
    scope: 'global' as const,
    totalTokens: 0,
    totalCost: 0,
    ...overrides
  };
}

function mountDialog(session = createSession()) {
  return mount(SessionRenameDialog, {
    props: { session },
    global: {
      stubs: {
        AppDialog: {
          props: ['open', 'title'],
          emits: ['update:open'],
          template: '<div v-if="open" class="dialog-stub"><slot /></div>'
        }
      }
    }
  });
}

describe('SessionRenameDialog', () => {
  it('prefills the current name and emits rename on submit', async () => {
    const wrapper = mountDialog();

    await wrapper.find('[aria-label="重命名 旧名字"]').trigger('click');
    const input = wrapper.find('input');
    expect((input.element as HTMLInputElement).value).toBe('旧名字');

    await input.setValue('  新名字  ');
    await wrapper.find('form').trigger('submit');

    expect(wrapper.emitted('rename')).toEqual([['session-1', '新名字']]);
    expect(wrapper.find('.dialog-stub').exists()).toBe(false);
  });

  it('closes without emitting when the name is empty or unchanged', async () => {
    const wrapper = mountDialog();

    await wrapper.find('[aria-label="重命名 旧名字"]').trigger('click');
    await wrapper.find('input').setValue('   ');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('rename')).toBeUndefined();

    await wrapper.find('[aria-label="重命名 旧名字"]').trigger('click');
    await wrapper.find('input').setValue('旧名字');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('rename')).toBeUndefined();

    await wrapper.find('[aria-label="重命名 旧名字"]').trigger('click');
    await wrapper.find('button[type="button"]:not([aria-label])').trigger('click');
    expect(wrapper.find('.dialog-stub').exists()).toBe(false);
  });
});
