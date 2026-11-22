import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, expect, it } from 'vitest';

import { useCloudSyncStore } from '@/features/cloud-sync';
import { useCreationStore } from '@/features/creation';
import { useSettingsStore } from '@/features/settings';

import StatusBar from '../StatusBar.vue';

afterEach(() => {
  delete window.chaptaleDesktop;
});

it('左下角以云备份设置状态为文案，点击直达云端账户', async () => {
  setActivePinia(createPinia());
  window.chaptaleDesktop = {
    settings: {
      getState: async () => ({ settings: { theme: 'light', editor: { autoSave: false } } })
    }
  } as unknown as NonNullable<typeof window.chaptaleDesktop>;
  const cloud = useCloudSyncStore();
  cloud.state = { accounts: [], authorizing: null, availability: [] };
  useCreationStore().connected = true;
  const wrapper = mount(StatusBar);

  const entry = () => wrapper.findAll('button').find(button => button.text().includes('云备份'))!;
  expect(entry().text()).toBe('尚未设置云备份');
  await entry().trigger('click');
  await flushPromises();
  expect(useSettingsStore().isOpen).toBe(true);
  expect(useSettingsStore().activeSection).toBe('cloudSync');

  cloud.state.accounts.push({ provider: 'dropbox', displayName: '作者', connectedAt: '2026-11-21T01:43:00Z' });
  await flushPromises();
  expect(entry().text()).toBe('云备份');
  wrapper.unmount();
});
