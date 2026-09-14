import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CloudBackupArchive, CloudBinding, ChaptaleSettingsState } from '@chaptale/ipc-contract';

import { AppCheckbox } from '@/components/AppCheckbox';
import { useSettingsStore } from '@/features/settings';

import CloudSyncSettings from '../CloudSyncSettings.vue';
import { useCloudSyncStore } from '../store';

function archive(name: string): CloudBackupArchive {
  return { id: name, name, sizeBytes: 2048, modifiedAt: '2026-09-13T21:04:05Z' };
}

/** 备份卡：面板里第一张 .cloud-card 是账户卡，所以按 aria 定位要验的那一张。 */
function backupCard(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('section[aria-labelledby="cloud-backup-title"]');
}

/** 归档那一行的复选：面板里第一个复选是「自动备份」开关，所以按行取，不按序号猜。 */
function archiveCheckbox(wrapper: ReturnType<typeof mount>, index: number) {
  return wrapper.findAll('.cloud-file').at(index)?.findComponent(AppCheckbox);
}

/** 按文案拿按钮：模板里的按钮只说人话，没有额外的 data-testid。 */
function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  const matches = wrapper.findAll('button').filter(button => button.text().trim() === text);

  if (matches.length !== 1) {
    const available = wrapper.findAll('button').map(button => JSON.stringify(button.text().replace(/s+/g, ' ').trim()));

    throw new Error(`期望恰好一个「${text}」按钮，实际 ${matches.length} 个；现有：${available.join(' / ')}`);
  }

  return matches[0]!;
}

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

  // 挂载时会自己去拉账户与清单：这里不替它们造数据，但要挡住真实 IPC——
  // 否则面板里会塞满“xxx is not a function”，把要验的那几行挤出视野。
  vi.spyOn(cloud, 'load').mockResolvedValue(undefined);
  vi.spyOn(cloud, 'loadBackups').mockResolvedValue(undefined);

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

  it('批量删除：勾中几份、二次确认后一次把所有选中的删掉', async () => {
    const { cloud, wrapper } = mountPanel();

    cloud.archives = [archive('a.zip'), archive('b.zip'), archive('c.zip')];
    const remove = vi.spyOn(cloud, 'removeBackups').mockResolvedValue(undefined);

    await wrapper.vm.$nextTick();

    // 没选任何一份时按钮就是不能按的：避免一次“删零份”的无意义调用。
    expect(buttonByText(wrapper, '删除所选').attributes('disabled')).toBeDefined();

    // 复选是组件不是原生 input：按组件事件驱动（原生 input 在 reka-ui 里不承载状态）。
    await archiveCheckbox(wrapper, 0)?.vm.$emit('update:modelValue', true);
    await archiveCheckbox(wrapper, 2)?.vm.$emit('update:modelValue', true);

    expect(wrapper.find('.cloud-files-head').text()).toContain('已选 2 份');

    await buttonByText(wrapper, '删除所选').trigger('click');

    // 先出确认页：这里一个字都不写远端。
    expect(remove).not.toHaveBeenCalled();
    expect(backupCard(wrapper).text()).toContain('从云端删除后无法恢复');

    await buttonByText(wrapper, '确认删除 2 份').trigger('click');

    expect(remove).toHaveBeenCalledWith(['a.zip', 'c.zip']);
  });

  it('复选重复报同一个值不算新意图；真改了选择才把确认页收起来', async () => {
    const { cloud, wrapper } = mountPanel();

    cloud.archives = [archive('a.zip'), archive('b.zip')];
    vi.spyOn(cloud, 'removeBackups').mockResolvedValue(undefined);
    await wrapper.vm.$nextTick();

    await archiveCheckbox(wrapper, 0)?.vm.$emit('update:modelValue', true);
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.cloud-files-head').text()).toContain('已选 1 份');
    // 选了一份之后按钮就得能按：按不动的话下面那条断言只是“什么都没发生”的假绿。
    expect(buttonByText(wrapper, '删除所选').attributes('disabled')).toBeUndefined();

    await buttonByText(wrapper, '删除所选').trigger('click');

    expect(buttonByText(wrapper, '确认删除 1 份').exists()).toBe(true);

    // 复选在失焦（点“删除所选”的那一下）会重复报同一个值：
    // 那不是作者改主意，确认页必须留在原地——否则他要删的东西会在指尖下消失。
    await archiveCheckbox(wrapper, 0)?.vm.$emit('update:modelValue', true);
    await wrapper.vm.$nextTick();

    expect(buttonByText(wrapper, '确认删除 1 份').exists()).toBe(true);

    // 真的多选了一份：这一回意图变了，确认页得收回去重新问。
    await archiveCheckbox(wrapper, 1)?.vm.$emit('update:modelValue', true);
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.cloud-files-head').text()).toContain('已选 2 份');
    expect(backupCard(wrapper).text()).not.toContain('无法恢复');
    expect(buttonByText(wrapper, '删除所选').attributes('disabled')).toBeUndefined();
  });
});
