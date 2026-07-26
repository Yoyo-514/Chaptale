import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PromptSettings from '../../sections/PromptSettings.vue';
import { useSettingsStore } from '../../store';

beforeEach(() => {
  setActivePinia(createPinia());
});

function installPromptState() {
  const settingsStore = useSettingsStore();
  settingsStore.promptSettings = {
    systemPrompt: '当前系统提示',
    appendSystemPrompt: '当前追加提示',
    defaultSystemPrompt: 'Chaptale 默认提示',
    systemPromptPath: 'C:/Users/test/.chaptale/agent/SYSTEM.md',
    appendSystemPromptPath: 'C:/Users/test/.chaptale/agent/APPEND_SYSTEM.md'
  };
  vi.spyOn(settingsStore, 'loadPromptSettings').mockResolvedValue(undefined);
  return settingsStore;
}

describe('PromptSettings', () => {
  it('edits both pi prompt files and saves their exact draft content', async () => {
    const settingsStore = installPromptState();
    const updatePromptSettings = vi.spyOn(settingsStore, 'updatePromptSettings').mockResolvedValue(true);
    const wrapper = mount(PromptSettings);
    await flushPromises();

    const editors = wrapper.findAll('textarea');
    expect(editors).toHaveLength(2);
    expect((editors[0]!.element as HTMLTextAreaElement).value).toBe('当前系统提示');
    expect(wrapper.text()).toContain('SYSTEM.md');
    expect(wrapper.text()).toContain('APPEND_SYSTEM.md');

    await editors[0]!.setValue('新的系统提示\n保留换行');
    await editors[1]!.setValue('新的追加提示');
    await wrapper.get('form').trigger('submit');

    expect(updatePromptSettings).toHaveBeenCalledWith({
      systemPrompt: '新的系统提示\n保留换行',
      appendSystemPrompt: '新的追加提示'
    });
  });

  it('restores the current built-in prompt into the draft without saving automatically', async () => {
    const settingsStore = installPromptState();
    const updatePromptSettings = vi.spyOn(settingsStore, 'updatePromptSettings').mockResolvedValue(true);
    const wrapper = mount(PromptSettings);
    await flushPromises();

    const restoreButton = wrapper.findAll('button').find(button => button.text().includes('恢复默认 System Prompt'))!;
    await restoreButton.trigger('click');

    expect((wrapper.findAll('textarea')[0]!.element as HTMLTextAreaElement).value).toBe('Chaptale 默认提示');
    expect(updatePromptSettings).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('有未保存修改');
  });

  it('rejects a blank system prompt in the form', async () => {
    installPromptState();
    const wrapper = mount(PromptSettings);
    await flushPromises();

    await wrapper.findAll('textarea')[0]!.setValue('   ');

    expect(wrapper.text()).toContain('System Prompt 不能为空');
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined();
  });
});
