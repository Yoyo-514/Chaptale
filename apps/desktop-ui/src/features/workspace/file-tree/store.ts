import { defineStore } from 'pinia';
import { computed, reactive, ref, watch } from 'vue';

import type { DirectoryEntry, WorkspaceChanged } from '@chaptale/ipc-contract';

import { useNotificationStore } from '@/features/notifications';
import { useSettingsStore } from '@/features/settings';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

export type FileTreeRow = DirectoryEntry & { depth: number; expanded: boolean; posInSet: number; setSize: number };

/** 新建行的落点：目标父目录（空串为根）与要创建的类型。 */
export type PendingCreation = { parent: string; kind: 'file' | 'directory' };

/**
 * 文件树的目录缓存、展开态与「显示内部文件」开关。
 *
 * 必须是单例：侧栏渲染树、设置面板改偏好，两处拿到的必须是同一份状态。
 * 开关的事实源在 settings（跨会话保留），这里只持有投影 + 重载逻辑，
 * 避免每个读它的地方都要自己 watch 一遍设置快照。
 */
export const useFileTreeStore = defineStore('workspace-file-tree', () => {
  const nodes = reactive<Record<string, DirectoryEntry[] | undefined>>({});
  const loading = reactive<Record<string, boolean>>({});
  const errors = reactive<Record<string, string>>({});
  const expanded = ref(new Set<string>());
  const selectedPath = ref('');
  const showInternalFiles = ref(false);
  const pendingCreation = ref<PendingCreation | null>(null);
  /** 根目录至少成功加载过一次；占位面板只属于「从未加载过」，刷新/显隐是重渲染不是空状态。 */
  const rootLoaded = ref(false);
  const settingsStore = useSettingsStore();
  const pending = new Map<string, symbol>();
  let revision = 0;

  // 设置快照是偏好的事实源：无论改动来自侧栏筛选按钮还是设置面板，都在这里收敛成一次重载。
  watch(
    () => settingsStore.state?.settings.explorer?.showInternalFiles,
    value => {
      if (typeof value === 'boolean') void applyShowInternalFiles(value);
    },
    { immediate: true }
  );

  const visibleRows = computed<FileTreeRow[]>(() => {
    const rows: FileTreeRow[] = [];
    const walk = (parent: string, depth: number) => {
      const entries = nodes[parent] ?? [];
      for (const [index, entry] of entries.entries()) {
        const open = expanded.value.has(entry.relativePath);
        rows.push({ ...entry, depth, expanded: open, posInSet: index + 1, setSize: entries.length });
        if (open) walk(entry.relativePath, depth + 1);
      }
    };
    walk('', 0);
    return rows;
  });

  async function fetchDirectory(relativePath: string) {
    const token = Symbol();
    pending.set(relativePath, token);
    loading[relativePath] = true;
    errors[relativePath] = '';

    try {
      const result = await getDesktopApi().workspace.listDirectory({
        relativePath,
        includeInternal: showInternalFiles.value
      });
      if (pending.get(relativePath) !== token) return;

      if (result.ok) {
        nodes[relativePath] = result.entries;
        if (relativePath === '') rootLoaded.value = true;
      } else {
        // 失败时清掉旧结果：留着会让人以为看到的是当前磁盘状态。
        delete nodes[relativePath];
        errors[relativePath] = result.message;
      }
    } catch (error) {
      if (pending.get(relativePath) !== token) return;
      delete nodes[relativePath];
      errors[relativePath] = toErrorMessage(error);
    } finally {
      if (pending.get(relativePath) === token) {
        pending.delete(relativePath);
        loading[relativePath] = false;
      }
    }
  }

  /**
   * 确保偏好已从设置读到，再决定首次取数带不带内部文件。
   *
   * 设置面板打开前没人 load 过设置；直接取数会先按默认值拉一遍、等设置到达再 reload，
   * 用户会看到目录内容闪一下。
   */
  async function loadPreferences() {
    if (!settingsStore.state) await settingsStore.load();

    const value = settingsStore.state?.settings.explorer?.showInternalFiles;
    if (typeof value === 'boolean') showInternalFiles.value = value;
  }

  /** 已缓存目录直接跳过；内容可能已变的场合（刷新、切换内部文件显隐）走 reload。 */
  async function load(relativePath = '') {
    if (nodes[relativePath] || loading[relativePath]) return;
    await fetchDirectory(relativePath);
  }

  async function toggle(path: string) {
    if (expanded.value.has(path)) {
      expanded.value.delete(path);
      return;
    }

    expanded.value.add(path);
    await load(path);
  }

  async function expand(path: string) {
    if (expanded.value.has(path)) return;
    expanded.value.add(path);
    await load(path);
  }

  /** 全部折叠；缓存留着，重新展开无需再请求。 */
  function collapseAll() {
    expanded.value.clear();
    cancelCreation();
  }

  /** 重新拉取根目录与所有已展开目录，保留展开态与选中项。 */
  async function reload() {
    const currentRevision = ++revision;
    pending.clear();
    for (const key of Object.keys(loading)) delete loading[key];
    // 先清缓存再置加载标记（同一次同步更新里完成）：树会短暂重排、整体闪一下，
    // 与 VS Code 的刷新观感一致；rootLoaded 已置位，占位面板不会顶掉树。
    for (const key of Object.keys(nodes)) delete nodes[key];
    loading[''] = true;

    // 目录之间互不依赖，串行只会把刷新耗时叠起来。
    await Promise.all(['', ...expanded.value].map(target => fetchDirectory(target)));
    if (revision !== currentRevision) return;

    // 目录可能已经不在了：展开态要跟着收回，否则 visibleRows 里会留一条空壳分支。
    // 迭代中删当前项是 Set 的明确行为，不需要先拷一份。
    for (const path of expanded.value) {
      if (!nodes[path]) expanded.value.delete(path);
    }
  }

  async function applyChanges(changes: WorkspaceChanged['changes']) {
    const parents = new Set<string>();
    for (const change of changes) {
      if (change.type === 'change') continue;
      const parent = change.relativePath.split('/').slice(0, -1).join('/');
      if (parent in nodes || expanded.value.has(parent) || parent === '') parents.add(parent);
      if (change.type === 'unlinkDir') {
        for (const key of Object.keys(nodes)) {
          if (key === change.relativePath || key.startsWith(`${change.relativePath}/`)) {
            delete nodes[key];
            pending.delete(key);
            expanded.value.delete(key);
          }
        }
      }
    }
    await Promise.all([...parents].map(parent => fetchDirectory(parent)));
  }

  /**
   * 应用设置快照里的偏好；值没变时不重拉，避免每次设置往返都刷一遍树。
   *
   * 偏好的事实源在 settings（跨会话保留），写入走 settings store 的 setShowInternalFiles；
   * 这里只负责跟随。写失败时快照不变，界面也就不动——免得看着开了、下次启动又变回去。
   */
  async function applyShowInternalFiles(value: boolean) {
    if (showInternalFiles.value === value) return;

    showInternalFiles.value = value;
    // 首次加载前（根目录还没拉过）不用重载，随后的 load 会带上新值。
    if (nodes['']) await reload();
  }

  /**
   * 用户显式切换：只负责落盘，界面由上面那个 watch 统一跟随。
   *
   * 写失败时快照不变，界面也就不动——免得看着开了、下次启动又变回去。
   */
  async function setShowInternalFiles(value: boolean) {
    if (showInternalFiles.value === value) return;
    await settingsStore.update({ explorer: { showInternalFiles: value } });
  }

  /**
   * 开始新建：父目录取当前选中项所在层级 —— 选中目录就建在其内部，
   * 选中文件就建在它的同级，与 VS Code 一致。
   */
  async function startCreation(kind: 'file' | 'directory') {
    const parent = resolveCreationParent();

    // 先展开，创建完成刷新父目录时新条目才是可见的。
    if (parent) await expand(parent);
    pendingCreation.value = { parent, kind };
  }

  function cancelCreation() {
    pendingCreation.value = null;
  }

  /** 提交新建；成功返回新条目相对路径，失败返回 null 并已提示用户。 */
  async function submitCreation(rawName: string): Promise<string | null> {
    const target = pendingCreation.value;
    if (!target) return null;

    const name = rawName.trim();
    if (!name) {
      cancelCreation();
      return null;
    }

    const relativePath = target.parent ? `${target.parent}/${name}` : name;
    const result = await getDesktopApi().workspace.createEntry({ relativePath, kind: target.kind });

    if (!result.ok) {
      // 不关对话框：名字冲突或非法时用户通常只想改几个字，清掉等于让人从头再来。
      useNotificationStore().error(target.kind === 'directory' ? '新建文件夹失败' : '新建文件失败', result.message);
      return null;
    }

    cancelCreation();
    await fetchDirectory(target.parent);
    selectedPath.value = relativePath;
    return relativePath;
  }

  function reset() {
    revision += 1;
    pending.clear();
    for (const key of Object.keys(nodes)) delete nodes[key];
    for (const key of Object.keys(loading)) delete loading[key];
    for (const key of Object.keys(errors)) delete errors[key];
    expanded.value.clear();
    selectedPath.value = '';
    pendingCreation.value = null;
    rootLoaded.value = false;
  }

  /** 选中目录 → 建在其内部；选中文件 → 建在其同级；无选中 → 建在根。 */
  function resolveCreationParent(): string {
    const selected = selectedPath.value;
    if (!selected) return '';

    const row = visibleRows.value.find(item => item.relativePath === selected);
    if (!row) return '';
    if (row.kind === 'directory') return selected;

    return selected.split('/').slice(0, -1).join('/');
  }

  return {
    nodes,
    loading,
    errors,
    expanded,
    selectedPath,
    showInternalFiles,
    pendingCreation,
    rootLoaded,
    visibleRows,
    loadPreferences,
    load,
    toggle,
    expand,
    collapseAll,
    reload,
    applyChanges,
    applyShowInternalFiles,
    setShowInternalFiles,
    startCreation,
    cancelCreation,
    submitCreation,
    reset
  };
});
