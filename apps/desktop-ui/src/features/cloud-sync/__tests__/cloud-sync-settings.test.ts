import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CloudBinding, ChaptaleSettingsState } from '@chaptale/ipc-contract';

import { useSettingsStore } from '@/features/settings';

import CloudSyncSettings from '../CloudSyncSettings.vue';
import { useCloudSyncStore } from '../store';

const binding: CloudBinding = {
  provider: 'dropbox',
  folderId: '',
  folderName: '应用文件夹',
  boundAt: '2026-09-13T00:00:00.000Z'
};

/** 设置面板只需要这几样；其余字段按主进程补齐后的形状给全，避免界面读到 undefined。 */
function settingsState(intervalMinutes: number) {
  return {
    settings: {
      version: 1,
      workspace: {},
      explorer: { showInternalFiles: false },
      editor: { autoSave: false },
      backup: { auto: true, intervalMinutes },
      onboarding: { completedVersion: 0 },
      theme: 'dark'
    },
    webTools: {
      search: { enabled: true, provider: 'duckduckgo' },
      keys: {},
      fetch: { timeoutSeconds: 30, maxBytes: 1 },
      ssrf: { allowRanges: [] }
    },
    paths: {}
  } as unknown as ChaptaleSettingsState;
}

function mountPanel(intervalMinutes = 1440) {
  const cloud = useCloudSyncStore();
  const settings = useSettingsStore();

  cloud.binding = binding;
  settings.state = settingsState(intervalMinutes);
  const update = vi.spyOn(settings, 'update').mockResolvedValue(true);

  const wrapper = mount(CloudSyncSettings, {
    global: {
      stubs: {
        // 设置分区只是个外壳；这里要验的是自动备份那几行。
        SettingsSection: { template: '<div><slot /></div>' },
        SettingsSectionView: { template: '<div><slot /></div>' },
        RestoreWizard: { template: '<div />' }
      }
    }
  });

  return { cloud, settings, update, wrapper };
}

beforeEach(() => {
  setActivePinia(createPinia());
  window.chaptaleDesktop = {
    cloudSync: { onBackupProgress: () => () => undefined }
  } as unknown as NonNullable<typeof window.chaptaleDesktop>;
});

describe('云同步设置里的自动备份', () => {
  it('打字途中的暂态不发 IPC：敲出 1440 的中途落盘的仍是合法值', async () => {
    const { update, wrapper } = mountPanel();
    const input = wrapper.find('.cloud-auto-interval input');

    // 这就是作者会遇到的路径：先把 1440 删成 1（低于下限 30），再补成 1440。
    await input.setValue('1');

    // 越界值留在本地，一个字节都不发出去；提示就地说明该怎么填。
    expect(update).not.toHaveBeenCalled();
    expect(wrapper.find('.cloud-auto').text()).toContain('请填 30 到 43200 之间的整数分钟');

    await input.setValue('1440');

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ backup: { intervalMinutes: 1440 } });
    expect(wrapper.find('.cloud-auto').text()).toContain('每天一次');
  });

  it('小数不是合法间隔：一样不发出去', async () => {
    const { update, wrapper } = mountPanel();

    await wrapper.find('.cloud-auto-interval input').setValue('1440.5');

    expect(update).not.toHaveBeenCalled();
    expect(wrapper.find('.cloud-auto').text()).toContain('整数分钟');
  });

  it('清空输入框不算一次修改：留给失焦或重填，不把默认值偷偷写回去', async () => {
    const { update, wrapper } = mountPanel();

    await wrapper.find('.cloud-auto-interval input').setValue('');

    expect(update).not.toHaveBeenCalled();
  });

  it('开关一拨就落盘，不受间隔输入的影响', async () => {
    const { update, wrapper } = mountPanel();

    wrapper.findComponent({ name: 'AppCheckbox' }).vm.$emit('update:modelValue', false);

    expect(update).toHaveBeenCalledWith({ backup: { auto: false } });
  });

  it('落盘的值变了（别处改过、旧配置回落）就同步到输入框上', async () => {
    const { settings, wrapper } = mountPanel(2160);

    expect((wrapper.find('.cloud-auto-interval input').element as HTMLInputElement).value).toBe('2160');

    settings.state = settingsState(60);
    await wrapper.vm.$nextTick();

    expect((wrapper.find('.cloud-auto-interval input').element as HTMLInputElement).value).toBe('60');
    expect(wrapper.find('.cloud-auto').text()).toContain('每 1 小时一次');
  });
});
