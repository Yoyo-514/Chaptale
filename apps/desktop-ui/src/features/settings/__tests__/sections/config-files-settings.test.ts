import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ConfigFilesSettings from '../../sections/ConfigFilesSettings.vue';
import { useSettingsStore } from '../../store';

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('ConfigFilesSettings', () => {
  it('renders config paths and opens the config directory', async () => {
    const settingsStore = useSettingsStore();
    settingsStore.state = {
      settings: { version: 1, storage: { mode: 'global' } },
      webAccess: {} as any,
      paths: {
        rootDir: 'root',
        agentDir: 'agent',
        settingsPath: 'settings.json',
        piSettingsPath: 'agent/settings.json',
        piModelsPath: 'agent/models.json',
        piAuthPath: 'agent/auth.json',
        piWebAccessConfigPath: 'agent/web-search.json',
        sessionsRootDir: 'agent/sessions',
        effectiveSessionDir: 'agent/sessions/global'
      }
    } as any;
    const openConfigDir = vi.spyOn(settingsStore, 'openConfigDir').mockResolvedValue(undefined);

    const wrapper = mount(ConfigFilesSettings);
    expect(wrapper.text()).toContain('settings.json');
    expect(wrapper.text()).toContain('agent/web-search.json');

    await wrapper.get('button').trigger('click');
    expect(openConfigDir).toHaveBeenCalled();
  });
});
