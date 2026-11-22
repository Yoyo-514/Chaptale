import { defineStore } from 'pinia';
import { onScopeDispose, ref, watch } from 'vue';

import type { Work, WorkPackageInfo, WorkSnapshot } from '@chaptale/creation/contracts';

import { useCloudSyncStore } from '@/features/cloud-sync';
import { useNotificationStore } from '@/features/notifications';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { requestCreation } from '../request';
import { useCreationStore } from '../store';

type PackageSource = { path: string; downloaded: boolean };

/** 作品包导出、导入与恢复；作品库与菜单栏共用。成功结果进通知中心，错误与同作品的选择框显示在作品库。 */
export const useWorkPackageStore = defineStore('creation-work-package', () => {
  const creation = useCreationStore();
  const error = ref('');
  const snapshots = ref<WorkSnapshot[]>([]);
  // 作品库已有同一部作品时，由作者选择另存副本或覆盖；目标与开关分开保存。
  const conflict = ref<(PackageSource & { info: WorkPackageInfo }) | null>(null);
  const conflictOpen = ref(false);

  function discardPackage(source: PackageSource) {
    if (source.downloaded) return useCloudSyncStore().discardDownload(source.path);
  }

  // 确认按钮先关弹窗，同一轮里 resolveConflict 取走目标；关窗后仍留着目标就是取消。
  watch(conflictOpen, open => {
    if (open || !conflict.value) return;
    const target = conflict.value;
    conflict.value = null;
    void discardPackage(target);
  });

  async function refreshSnapshots() {
    snapshots.value = await requestCreation('listWorkSnapshots', {});
  }
  // 永久删除作品时快照一并移走，作品列表变化时重读。
  const off = watch(
    [() => creation.connected, () => creation.works],
    ([connected]) => {
      if (connected) void refreshSnapshots().catch(cause => (error.value = toErrorMessage(cause)));
    },
    { immediate: true }
  );
  onScopeDispose(off);

  /** 选择保存位置并导出；取消时返回 null。 */
  async function exportWork(work: Work): Promise<string | null> {
    const path = await getDesktopApi().creation.selectPackageSavePath(work.title);
    if (!path) return null;
    await requestCreation('exportWorkPackage', { workId: work.id, path });
    return path;
  }

  async function run(action: () => Promise<void>) {
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
      if (path) useNotificationStore().success(`已导出《${work.title}》`, path);
    });
  }

  async function install(source: PackageSource, asCopy: boolean, replaceWorkId?: string) {
    const request = () =>
      getDesktopApi().agentHost.request('importWorkPackage', {
        commandId: crypto.randomUUID(),
        path: source.path,
        asCopy
      });
    try {
      if (!asCopy && replaceWorkId) {
        let title = '';
        const replaced = await creation.replaceWork(replaceWorkId, async () => {
          title = (await request()).work.title;
        });
        if (replaced) useNotificationStore().success(`已导入《${title}》`);
      } else {
        const { work } = await request();
        await creation.refreshLibrary();
        useNotificationStore().success(`已导入《${work.title}》`);
      }
      await refreshSnapshots();
    } finally {
      await discardPackage(source);
    }
  }

  /** 不给来源时让作者选作品包；云端恢复传入下载的临时包（导入后清理），本机备份传入原包（保留）。 */
  function chooseImport(picked?: PackageSource) {
    return run(async () => {
      const path = picked?.path ?? (await getDesktopApi().creation.selectPaths('import-package'))?.[0];
      if (!path) return;
      const source = { path, downloaded: picked?.downloaded ?? false };
      let info: WorkPackageInfo;
      try {
        info = await requestCreation('inspectWorkPackage', { path });
      } catch (cause) {
        await discardPackage(source);
        throw cause;
      }
      if (!info.exists) return install(source, false);
      conflict.value = { ...source, info };
      conflictOpen.value = true;
    });
  }

  function resolveConflict(asCopy: boolean) {
    const target = conflict.value;
    conflict.value = null;
    conflictOpen.value = false;
    if (target) void run(() => install(target, asCopy, target.info.work.id));
  }

  function restoreSnapshot(workId: string) {
    return run(async () => {
      let title = '';
      const restored = await creation.replaceWork(workId, async () => {
        const result = await getDesktopApi().agentHost.request('restoreWorkSnapshot', {
          commandId: crypto.randomUUID(),
          workId
        });
        title = result.work.title;
      });
      if (restored) useNotificationStore().success(`已恢复《${title}》导入前的版本`);
      await refreshSnapshots();
    });
  }

  return {
    error,
    snapshots,
    conflict,
    conflictOpen,
    exportWork,
    exportFromLibrary,
    chooseImport,
    resolveConflict,
    restoreSnapshot
  };
});
