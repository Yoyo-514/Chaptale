import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import BackupArchives from '../components/BackupArchives.vue';
import RestoreConflicts from '../components/RestoreConflicts.vue';
import RestorePlan from '../components/RestorePlan.vue';
import { useCloudSyncStore } from '../store';

let wrapper: VueWrapper | undefined;

beforeEach(() => {
  setActivePinia(createPinia());
  useCloudSyncStore().wizard = {
    archiveId: 'backup.zip',
    archiveName: '作品备份.zip',
    plan: {
      archiveId: 'backup.zip',
      identityMatches: true,
      entries: [{ relativePath: '正文.md', verdict: 'conflict', archiveBytes: 10, localBytes: 20, system: false }],
      emptyDirectories: [],
      localOnly: 0
    },
    mode: 'new',
    choices: {},
    diff: null,
    receipt: null,
    workspace: { rootPath: null, revision: 0 }
  };
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

describe('恢复控件交互', () => {
  it('方向键切换恢复方式并同步选中状态', async () => {
    const cloud = useCloudSyncStore();
    wrapper = mount(RestorePlan, { props: { wizard: cloud.wizard! }, attachTo: document.body });
    await flushPromises();
    const radios = wrapper.findAll('[role="radio"]');
    (radios[0]!.element as HTMLElement).focus();
    await radios[0]!.trigger('keydown', { key: 'ArrowRight' });

    await expect.poll(() => cloud.wizard?.mode).toBe('overwrite');
    expect(radios[1]!.attributes('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radios[1]!.element);
  });

  it('身份不匹配或正在执行时不能切换恢复方式', async () => {
    const cloud = useCloudSyncStore();
    cloud.wizard!.plan.identityMatches = false;
    wrapper = mount(RestorePlan, { props: { wizard: cloud.wizard! }, attachTo: document.body });
    await flushPromises();
    const radios = wrapper.findAll('[role="radio"]');
    expect(radios[1]!.attributes('disabled')).toBeDefined();
    expect(radios[2]!.attributes('disabled')).toBeDefined();
    (radios[1]!.element as HTMLButtonElement).click();
    expect(cloud.wizard!.mode).toBe('new');

    cloud.isApplying = true;
    await flushPromises();
    expect(radios.every(radio => radio.attributes('disabled') !== undefined)).toBe(true);
  });

  it('冲突决议有独立分组，执行时保持原决议', async () => {
    const cloud = useCloudSyncStore();
    cloud.wizard!.mode = 'merge';
    wrapper = mount(RestoreConflicts, { props: { wizard: cloud.wizard! }, attachTo: document.body });
    await flushPromises();
    expect(wrapper.get('[role="radiogroup"]').attributes('aria-label')).toBe('正文.md 用哪一份');
    const radios = wrapper.findAll('[role="radio"]');
    await radios[1]!.trigger('click');
    expect(cloud.wizard!.choices).toEqual({ '正文.md': 'local' });
    expect(wrapper.find('.is-pending').exists()).toBe(false);

    cloud.isApplying = true;
    await flushPromises();
    expect(radios.every(radio => radio.attributes('disabled') !== undefined)).toBe(true);
    (radios[0]!.element as HTMLButtonElement).click();
    expect(cloud.wizard!.choices).toEqual({ '正文.md': 'local' });
  });

  it('归档清单或绑定变化后清除陈旧的删除确认', async () => {
    const cloud = useCloudSyncStore();
    cloud.archives = [
      { id: 'a', name: 'a.zip', sizeBytes: 10, modifiedAt: null },
      { id: 'b', name: 'b.zip', sizeBytes: 20, modifiedAt: null }
    ];
    wrapper = mount(BackupArchives, { attachTo: document.body });
    await flushPromises();
    await wrapper.findAll('[role="checkbox"]')[0]!.trigger('click');
    await wrapper.get('.cloud-files-head button').trigger('click');
    expect(wrapper.get('[role="alert"]').text()).toContain('这 1 份归档');

    cloud.archives = [cloud.archives[1]!];
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get('.cloud-files-head').text()).toContain('已选 0 份');
    expect(wrapper.get('.cloud-files-head button').attributes('disabled')).toBeDefined();

    await wrapper.get('[role="checkbox"]').trigger('click');
    cloud.binding = { provider: 'dropbox', folderId: 'different', folderName: '另一目录', boundAt: '' };
    await flushPromises();
    expect(wrapper.get('.cloud-files-head').text()).toContain('已选 0 份');
  });
});
