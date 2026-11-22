import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { Work } from '@chaptale/creation/contracts';

import { useCreationStore } from '../../store';
import WorksLibrary from '../WorksLibrary.vue';

const name = '雨夜_2026-11-21_0143.chaptale';
const path = 'C:/Temp/chaptale-restore-1/backup.chaptale';
const time = Date.UTC(2026, 10, 21);
const work: Work = { id: 'w1', title: '雨夜', kind: 'novel', createdAt: time, updatedAt: time };
const inspect = vi.fn();
const install = vi.fn();
const discardDownload = vi.fn();
let wrapper: VueWrapper;

beforeEach(() => {
  inspect.mockReset().mockResolvedValue({ ok: true, value: { work, exists: false } });
  install.mockReset().mockResolvedValue({ work, files: [] });
  discardDownload.mockReset().mockResolvedValue(undefined);
  window.chaptaleDesktop = {
    creation: {
      request: async (method: string, input: unknown) => {
        if (method === 'inspectWorkPackage') return inspect(input);
        if (method === 'listWorks') return { ok: true, value: [work] };
        if (method === 'listWorkSnapshots' || method === 'listTrashedWorks') return { ok: true, value: [] };
        throw new Error(`意外作品请求：${method}`);
      }
    },
    agentHost: { request: install },
    cloudSync: {
      getState: async () => ({
        availability: [{ provider: 'dropbox', configured: true }],
        accounts: [{ provider: 'dropbox', displayName: '作者', connectedAt: new Date(time).toISOString() }],
        authorizing: null
      }),
      listBackups: async () => ({ ok: true, backups: [{ id: `/${name}`, name }] }),
      downloadBackup: async () => ({ ok: true, path }),
      discardDownload
    }
  } as unknown as NonNullable<typeof window.chaptaleDesktop>;
  setActivePinia(createPinia());
  useCreationStore().connected = true;
  wrapper = mount(WorksLibrary, { attachTo: document.body });
});
afterEach(() => {
  wrapper.unmount();
  delete window.chaptaleDesktop;
});

async function restoreFromCloud() {
  await wrapper
    .findAll('button')
    .find(button => button.text() === '从云端恢复')!
    .trigger('click');
  await flushPromises();
  document.body.querySelector<HTMLButtonElement>(`button[aria-label="恢复 其他作品包 ${name}（Dropbox）"]`)!.click();
  await flushPromises();
}

it('下载的包在导入期间仍保留，导入完成后清理', async () => {
  const importing = Promise.withResolvers<{ work: Work; files: string[] }>();
  install.mockReturnValueOnce(importing.promise);
  await restoreFromCloud();

  expect(install).toHaveBeenCalledWith('importWorkPackage', expect.objectContaining({ path, asCopy: false }));
  expect(discardDownload).not.toHaveBeenCalled();

  importing.resolve({ work, files: [] });
  await flushPromises();
  expect(discardDownload).toHaveBeenCalledExactlyOnceWith(path);
});

it.each(['取消', '另存为副本'])('已有同一作品时，点「%s」结束选择并清理下载包', async choice => {
  inspect.mockResolvedValueOnce({ ok: true, value: { work, exists: true } });
  await restoreFromCloud();

  const dialog = document.body.querySelector('[role="alertdialog"]')!;
  expect(dialog.textContent).toContain('作品库中已有《雨夜》');
  expect(discardDownload).not.toHaveBeenCalled();
  [...dialog.querySelectorAll('button')].find(button => button.textContent?.trim() === choice)!.click();
  await flushPromises();

  if (choice === '取消') expect(install).not.toHaveBeenCalled();
  else expect(install).toHaveBeenCalledWith('importWorkPackage', expect.objectContaining({ path, asCopy: true }));
  expect(discardDownload).toHaveBeenCalledExactlyOnceWith(path);
});

it('作品包检查失败时显示原因并清理下载包', async () => {
  inspect.mockResolvedValueOnce({ ok: false, error: { message: '所选文件不是 Chaptale 作品包' } });
  await restoreFromCloud();

  expect(wrapper.get('[role="alert"]').text()).toContain('所选文件不是 Chaptale 作品包');
  expect(install).not.toHaveBeenCalled();
  expect(discardDownload).toHaveBeenCalledExactlyOnceWith(path);
});
