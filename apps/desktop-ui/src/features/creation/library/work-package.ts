import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { Work, WorkPackageInfo } from '@chaptale/creation/contracts';

import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { requestCreation } from '../request';

/** 作品包导出与导入；作品库按钮与菜单栏共用，导入结果与同作品的选择框显示在作品库。 */
export const useWorkPackageStore = defineStore('creation-work-package', () => {
  const notice = ref('');
  const error = ref('');
  // 作品库已有同一部作品时，由作者选择另存副本或覆盖；目标与开关分开保存。
  const conflict = ref<{ path: string; info: WorkPackageInfo } | null>(null);
  const conflictOpen = ref(false);

  /** 选择保存位置并导出；取消时返回 null。 */
  async function exportWork(work: Work): Promise<string | null> {
    const path = await getDesktopApi().creation.selectPackageSavePath(work.title);
    if (!path) return null;
    await requestCreation('exportWorkPackage', { workId: work.id, path });
    return path;
  }

  async function run(action: () => Promise<void>) {
    notice.value = '';
    error.value = '';
    try {
      await action();
    } catch (cause) {
      error.value = toErrorMessage(cause);
    }
  }

  function exportFromLibrary(work: Work) {
    return run(async () => {
      const path = await exportWork(work);
      if (path) notice.value = `已导出《${work.title}》到 ${path}`;
    });
  }

  async function install(path: string, asCopy: boolean) {
    const work = await requestCreation('importWorkPackage', { commandId: crypto.randomUUID(), path, asCopy });
    notice.value = `已导入《${work.title}》`;
  }

  function chooseImport() {
    return run(async () => {
      const path = (await getDesktopApi().creation.selectPaths('import-package'))?.[0];
      if (!path) return;
      const info = await requestCreation('inspectWorkPackage', { path });
      if (!info.exists) return install(path, false);
      conflict.value = { path, info };
      conflictOpen.value = true;
    });
  }

  function resolveConflict(asCopy: boolean) {
    const target = conflict.value;
    conflictOpen.value = false;
    if (target) void run(() => install(target.path, asCopy));
  }

  return { notice, error, conflict, conflictOpen, exportWork, exportFromLibrary, chooseImport, resolveConflict };
});
