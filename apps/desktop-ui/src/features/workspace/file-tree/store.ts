import { computed, reactive, ref } from 'vue';

import type { DirectoryEntry } from '@chaptale/ipc-contract';

import { getDesktopApi } from '@/utils/desktop-api';

export function useFileTreeStore() {
  const nodes = reactive<Record<string, DirectoryEntry[] | undefined>>({});
  const loading = reactive<Record<string, boolean>>({});
  const errors = reactive<Record<string, string>>({});
  const expanded = ref(new Set<string>());
  const selectedPath = ref('');
  const visibleRows = computed(() => {
    const rows: Array<DirectoryEntry & { depth: number; expanded: boolean }> = [];
    const walk = (parent: string, depth: number) => {
      for (const entry of nodes[parent] ?? []) {
        const open = expanded.value.has(entry.relativePath);
        rows.push({ ...entry, depth, expanded: open });
        if (open) walk(entry.relativePath, depth + 1);
      }
    };
    walk('', 0);
    return rows;
  });
  async function load(relativePath = '', includeInternal = false) {
    if (nodes[relativePath] || loading[relativePath]) return;
    loading[relativePath] = true;
    errors[relativePath] = '';
    const result = await getDesktopApi().workspace.listDirectory({ relativePath, includeInternal });
    if (result.ok) nodes[relativePath] = result.entries;
    else errors[relativePath] = result.message;
    loading[relativePath] = false;
  }
  async function toggle(path: string, includeInternal = false) {
    if (expanded.value.has(path)) expanded.value.delete(path);
    else {
      expanded.value.add(path);
      await load(path, includeInternal);
    }
  }
  function reset() {
    for (const key of Object.keys(nodes)) delete nodes[key];
    expanded.value.clear();
    selectedPath.value = '';
  }
  return { nodes, loading, errors, expanded, selectedPath, visibleRows, load, toggle, reset };
}
