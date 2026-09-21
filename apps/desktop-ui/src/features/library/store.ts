import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';

import type { PackFreshness } from '@chaptale/ipc-contract';
import type { AssetSnapshot, ReferencePack, ReferenceSelection } from '@chaptale/shared';

import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

export const useLibraryStore = defineStore('library', () => {
  const workspace = useWorkspaceStore();
  const snapshot = shallowRef<AssetSnapshot | null>(null);
  const selections = ref<ReferenceSelection[]>([]);
  const goal = ref('');
  const scenePath = ref<string>();
  const chapterPath = ref<string>();
  const sceneDiagnostics = ref<string[]>([]);
  const excluded = ref<string[]>([]);
  let sceneGoal = '';
  let sceneSequence = 0;
  const budgetChars = ref(9000);
  const pack = shallowRef<ReferencePack | null>(null);
  const frozen = shallowRef<ReferencePack | null>(null);
  const freshness = shallowRef<PackFreshness | null>(null);
  const error = ref('');
  const loading = ref(false);
  const busy = ref(false);
  let loadSequence = 0;
  let composeSequence = 0;
  let freezeSequence = 0;
  let freshnessSequence = 0;
  let composeTimer: ReturnType<typeof setTimeout> | undefined;
  const assets = computed(() => snapshot.value?.assets ?? []);
  const available = computed(() =>
    assets.value.filter(asset => asset.status !== 'archived' && asset.role !== 'templates')
  );
  const largest = computed(() => pack.value?.sections.toSorted((a, b) => b.chars - a.chars)[0]?.sourcePath);

  function args() {
    if (!workspace.rootPath) throw new Error('请先打开作品');
    return {
      rootPath: workspace.rootPath,
      goal: goal.value,
      selections: selections.value.map(value => ({ ...value })),
      budgetChars: budgetChars.value,
      ...(scenePath.value ? { scenePath: scenePath.value } : {})
    };
  }
  async function load() {
    const rootPath = workspace.rootPath;
    if (!rootPath) return;
    const sequence = ++loadSequence;
    loading.value = true;
    try {
      const result = await getDesktopApi().library.listAssets({ rootPath });
      if (sequence === loadSequence && rootPath === workspace.rootPath) {
        snapshot.value = result;
        error.value = '';
      }
    } catch (cause) {
      if (sequence === loadSequence) error.value = toErrorMessage(cause);
    } finally {
      if (sequence === loadSequence) loading.value = false;
    }
  }
  async function compose() {
    if (!workspace.rootPath) return;
    clearTimeout(composeTimer);
    const request = args();
    const sequence = ++composeSequence;
    try {
      const result = await getDesktopApi().library.composePack(request);
      if (sequence === composeSequence && request.rootPath === workspace.rootPath) {
        pack.value = result;
        error.value = '';
      }
    } catch (cause) {
      if (sequence === composeSequence) {
        pack.value = null;
        error.value = toErrorMessage(cause);
      }
    }
  }
  function add(sourcePath: string, quote?: string) {
    excluded.value = excluded.value.filter(path => path !== sourcePath);
    const existing = selections.value.find(selection => selection.sourcePath === sourcePath);
    const selection: ReferenceSelection = {
      sourcePath,
      pinned: true,
      mode: 'full',
      ...(quote ? { quote } : {}),
      reason: '作者选择'
    };
    if (existing) Object.assign(existing, selection, { quote });
    else selections.value.push(selection);
  }
  function remove(sourcePath: string) {
    if (scenePath.value && !excluded.value.includes(sourcePath)) excluded.value.push(sourcePath);
    selections.value = selections.value.filter(selection => selection.sourcePath !== sourcePath);
  }
  function selectionKey() {
    return JSON.stringify([selections.value, excluded.value]);
  }
  async function rebuildScene() {
    const rootPath = workspace.rootPath;
    const scene = scenePath.value;
    if (!rootPath || !scene) return;
    const token = ++sceneSequence;
    const requestedSelection = selectionKey();
    try {
      const result = await getDesktopApi().library.sceneReferences({
        rootPath,
        scenePath: scene,
        selections: selections.value.map(value => ({ ...value })),
        excluded: [...excluded.value]
      });
      if (token !== sceneSequence || scene !== scenePath.value || rootPath !== workspace.rootPath) return;
      if (selectionKey() !== requestedSelection) {
        await rebuildScene();
        return;
      }
      if (goal.value === sceneGoal || !goal.value) goal.value = result.goal;
      sceneGoal = result.goal;
      chapterPath.value = result.chapterPath;
      sceneDiagnostics.value = result.diagnostics;
      selections.value = result.selections;
    } catch (cause) {
      if (token === sceneSequence) error.value = toErrorMessage(cause);
    }
  }
  async function useScene(path?: string) {
    if (scenePath.value !== path) {
      excluded.value = [];
      selections.value = selections.value.filter(value => value.pinned);
      goal.value = '';
      sceneGoal = '';
    }
    scenePath.value = path;
    chapterPath.value = undefined;
    sceneDiagnostics.value = [];
    if (path) await rebuildScene();
    else ++sceneSequence;
    await compose();
  }
  async function restoreExcluded() {
    excluded.value = [];
    await rebuildScene();
    await compose();
  }
  async function freeze() {
    if (!workspace.rootPath || busy.value) return;
    const request = args();
    const sequence = ++freezeSequence;
    clearTimeout(composeTimer);
    ++composeSequence;
    busy.value = true;
    try {
      const result = await getDesktopApi().library.freezePack(request);
      if (sequence !== freezeSequence || workspace.rootPath !== request.rootPath) return;
      frozen.value = result;
      pack.value = result;
      freshness.value = null;
      error.value = '';
      return result;
    } catch (cause) {
      if (sequence === freezeSequence) error.value = toErrorMessage(cause);
      return undefined;
    } finally {
      if (sequence === freezeSequence) busy.value = false;
    }
  }
  async function checkFreshness() {
    if (!frozen.value || !workspace.rootPath) return;
    const rootPath = workspace.rootPath;
    const packId = frozen.value.id;
    const sequence = ++freshnessSequence;
    try {
      const result = await getDesktopApi().library.checkPack({ rootPath, packId });
      if (sequence === freshnessSequence && workspace.rootPath === rootPath && frozen.value?.id === packId)
        freshness.value = result;
    } catch (cause) {
      if (sequence === freshnessSequence) error.value = toErrorMessage(cause);
    }
  }
  async function refresh() {
    const rootPath = workspace.rootPath;
    await load();
    if (rootPath !== workspace.rootPath) return;
    await rebuildScene();
    if (rootPath !== workspace.rootPath) return;
    await checkFreshness();
    if (rootPath !== workspace.rootPath) return;
    await compose();
  }
  watch(
    [goal, selections, budgetChars, scenePath],
    () => {
      ++composeSequence;
      clearTimeout(composeTimer);
      composeTimer = setTimeout(() => {
        void compose();
      }, 180);
    },
    { deep: true, flush: 'sync' }
  );
  function reset() {
    ++loadSequence;
    ++composeSequence;
    ++freezeSequence;
    ++freshnessSequence;
    ++sceneSequence;
    snapshot.value = null;
    selections.value = [];
    goal.value = '';
    scenePath.value = undefined;
    chapterPath.value = undefined;
    sceneDiagnostics.value = [];
    excluded.value = [];
    sceneGoal = '';
    pack.value = null;
    frozen.value = null;
    freshness.value = null;
    loading.value = false;
    busy.value = false;
    error.value = '';
    clearTimeout(composeTimer);
  }
  watch(() => [workspace.rootPath, workspace.revision], reset, { flush: 'sync' });
  onScopeDispose(reset);
  return {
    snapshot,
    assets,
    available,
    selections,
    goal,
    scenePath,
    chapterPath,
    sceneDiagnostics,
    excluded,
    budgetChars,
    pack,
    frozen,
    freshness,
    error,
    loading,
    busy,
    largest,
    load,
    compose,
    add,
    remove,
    freeze,
    checkFreshness,
    refresh,
    useScene,
    restoreExcluded
  };
});
