import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, watch } from 'vue';

import type {
  CreationCommands,
  CreationEvent,
  CreationResult,
  Entry,
  PendingChange,
  Work,
  WorkbenchState,
  WorkViewState
} from '@chaptale/creation/contracts';

import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';
import { confirmWorkspaceTransition } from '@/utils/workspace-transition';

export class CreationRequestError extends Error {
  readonly detail: Extract<CreationResult<never>, { ok: false }>['error'];
  constructor(detail: Extract<CreationResult<never>, { ok: false }>['error']) {
    super(detail.message);
    this.detail = detail;
  }
}

type Value<K extends keyof CreationCommands> = Extract<CreationCommands[K]['output'], { ok: true }>['value'];
export async function requestCreation<K extends keyof CreationCommands>(
  method: K,
  input: CreationCommands[K]['input']
): Promise<Value<K>> {
  // 作品契约只含纯 JSON；入队时捕获独立快照，去掉嵌套的响应式代理并隔离后续修改
  const snapshot = JSON.parse(JSON.stringify(input)) as typeof input;
  const result = await getDesktopApi().creation.request(method, snapshot);
  if (!result.ok) throw new CreationRequestError(result.error);
  return result.value as Value<K>;
}

/** 作品与目录取服务快照；本机导航只保存稳定身份和位置。 */
export const useCreationStore = defineStore('creation', () => {
  const works = ref<Work[]>([]);
  const entries = ref<Entry[]>([]);
  /** 当前作品所有会话的待接受修改，供目录标记与显示新建候选；修改本身在审阅标签中处理。 */
  const pendingChanges = ref<PendingChange[]>([]);
  const pendingEntryIds = computed<ReadonlySet<string>>(
    () => new Set(pendingChanges.value.filter(change => change.base !== null).map(change => change.entryId))
  );
  const state = ref<WorkbenchState>({ activeWorkId: null, works: [] });
  const libraryOpen = ref(true);
  const connected = ref(false);
  const busy = ref(false);
  const error = ref('');
  const stateError = ref('');
  const newWorkOpen = ref(false);
  const newEntry = ref<{ kind: Entry['kind']; parentId: string | null } | null>(null);
  const importOpen = ref(false);
  const exportOpen = ref(false);
  const workId = computed(() => state.value.activeWorkId);
  const work = computed(() => works.value.find(item => item.id === workId.value));
  const view = computed(() => (workId.value ? viewFor(workId.value) : null));
  let initialized = false;
  let connecting: Promise<void> | undefined;
  let cursor = 0;
  let offEvent: (() => void) | undefined;
  let offDisconnect: (() => void) | undefined;
  let pendingState: string | undefined;
  let writing: Promise<boolean> | undefined;

  function viewFor(id: string): WorkViewState {
    let item = state.value.works.find(candidate => candidate.workId === id);
    if (!item) {
      item = {
        workId: id,
        tabs: [],
        activeDocumentId: null,
        secondaryDocumentId: null,
        section: 'manuscript',
        manuscript: { expandedIds: [], selectedId: null, scrollTop: 0 },
        resource: { expandedIds: [], selectedId: null, scrollTop: 0 }
      };
      state.value.works.push(item);
      item = state.value.works.at(-1)!;
    }
    return item;
  }

  function persistState(): Promise<boolean> {
    // 工作台契约只含 JSON 数据；序列化整份快照，解开标签重排后嵌入的各层 Vue 代理。
    pendingState = JSON.stringify(state.value);
    writing ??= (async () => {
      stateError.value = '';
      try {
        while (pendingState) {
          const next = pendingState;
          pendingState = undefined;
          await requestCreation('writeWorkbench', JSON.parse(next) as WorkbenchState);
        }
        return true;
      } catch (cause) {
        stateError.value = `工作台位置保存失败：${toErrorMessage(cause)}`;
        return false;
      } finally {
        writing = undefined;
      }
    })();
    return writing;
  }
  watch(
    state,
    () => {
      if (initialized) void persistState();
    },
    { deep: true }
  );

  async function refreshLibrary() {
    const snapshot = await requestCreation('snapshot', { workId: null });
    if (snapshot.kind === 'library') works.value = snapshot.works;
  }

  async function refreshEntries() {
    const id = workId.value;
    if (!id) return;
    const snapshot = await requestCreation('snapshot', { workId: id });
    if (workId.value === id && snapshot.kind === 'work' && snapshot.cursor.sequence >= cursor) {
      entries.value = snapshot.entries;
      cursor = snapshot.cursor.sequence;
    }
  }

  const listeners = new Set<(event: CreationEvent) => void>();
  /** 待审与交付视图按作品事件刷新；事件先通知订阅者，再推进目录游标。 */
  function onEvent(listener: (event: CreationEvent) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  let pendingRequest = 0;
  async function refreshPending() {
    const id = workId.value;
    const request = ++pendingRequest;
    if (!id) {
      pendingChanges.value = [];
      return;
    }
    const changes = await requestCreation('listPendingChanges', { workId: id, sessionId: null });
    if (request === pendingRequest) pendingChanges.value = changes;
  }
  function reportPending() {
    void refreshPending().catch(cause => {
      error.value = toErrorMessage(cause);
    });
  }
  watch(workId, reportPending);

  function apply(event: CreationEvent) {
    for (const listener of listeners) listener(event);
    if (event.change.kind === 'review' && event.change.change.workId === workId.value) reportPending();
    if (event.change.kind === 'entries' && event.cursor.workId === workId.value) reportPending();
    // 待审修改及继续进度保持在本机，正式目录使用作品库内的条目游标。
    if (event.change.kind === 'review' || event.change.kind === 'delivery') return;
    if (event.change.kind === 'library') {
      void refreshLibrary().then(() => {
        if (!works.value.some(item => item.id === workId.value)) dropWork(workId.value);
      });
      return;
    }
    if (event.change.kind === 'work') {
      const next = event.change.work;
      works.value = [...works.value.filter(item => item.id !== next.id), next];
      return;
    }
    if (event.cursor.workId !== workId.value || event.cursor.sequence <= cursor) return;
    if (event.change.kind !== 'entry' || event.cursor.sequence !== cursor + 1) {
      void refreshEntries().catch(cause => {
        error.value = toErrorMessage(cause);
      });
      return;
    }
    const next = event.change.entry;
    entries.value = [...entries.value.filter(item => item.id !== next.id), next];
    cursor = event.cursor.sequence;
  }

  function connect(): Promise<void> {
    if (connecting) return connecting;
    connecting = (async () => {
      busy.value = true;
      error.value = '';
      offEvent?.();
      offDisconnect?.();
      const client = getDesktopApi().creation;
      const buffered: CreationEvent[] = [];
      let syncing = true;
      offEvent = client.subscribe(event => (syncing ? buffered.push(event) : apply(event)));
      offDisconnect = client.onDisconnected(message => {
        connected.value = false;
        error.value = message;
      });
      try {
        const restored = initialized ? state.value : await requestCreation('readWorkbench', {});
        await refreshLibrary();
        cursor = 0;
        if (restored.activeWorkId) {
          const snapshot = await requestCreation('snapshot', { workId: restored.activeWorkId });
          if (snapshot.kind === 'work') {
            entries.value = snapshot.entries;
            cursor = snapshot.cursor.sequence;
          }
        }
        if (!initialized) {
          state.value = restored;
          libraryOpen.value = !restored.activeWorkId;
        }
        initialized = true;
        for (const event of buffered) apply(event);
        syncing = false;
        connected.value = true;
        reportPending();
      } catch (cause) {
        error.value = toErrorMessage(cause);
        connected.value = false;
      } finally {
        busy.value = false;
        connecting = undefined;
      }
    })();
    return connecting;
  }

  async function openWork(id: string): Promise<boolean> {
    if (id === workId.value) {
      libraryOpen.value = false;
      return true;
    }
    if (!(await confirmWorkspaceTransition())) return false;
    busy.value = true;
    error.value = '';
    try {
      // 先完成目标读取，失败时原作品和输入继续留在界面。
      const snapshot = await requestCreation('snapshot', { workId: id });
      if (snapshot.kind !== 'work') throw new Error('作品快照类型错误');
      viewFor(id);
      entries.value = snapshot.entries;
      cursor = snapshot.cursor.sequence;
      state.value.activeWorkId = id;
      libraryOpen.value = false;
      return true;
    } catch (cause) {
      error.value = toErrorMessage(cause);
      return false;
    } finally {
      busy.value = false;
    }
  }

  /** 作品离开作品库后移除其工作区状态；正在打开时回到作品库。 */
  function dropWork(id: string | null) {
    if (!id) return;
    state.value.works = state.value.works.filter(item => item.workId !== id);
    if (state.value.activeWorkId !== id) return;
    state.value.activeWorkId = null;
    entries.value = [];
    libraryOpen.value = true;
  }

  /** 由宿主检查运行中的会话并关闭该作品已打开的会话，再移入作品库回收站。 */
  async function trashWork(id: string): Promise<boolean> {
    if (id === workId.value && !(await confirmWorkspaceTransition())) return false;
    await getDesktopApi().agentHost.request('trashWork', { commandId: crypto.randomUUID(), workId: id });
    dropWork(id);
    await refreshLibrary();
    return true;
  }

  async function showLibrary() {
    libraryOpen.value = true;
    try {
      await refreshLibrary();
    } catch (cause) {
      error.value = toErrorMessage(cause);
    }
  }

  async function createWork(title: string, kind: Work['kind'], commandId: string) {
    const created = await requestCreation('createWork', { commandId, title, kind });
    await refreshLibrary();
    if (await openWork(created.id)) newWorkOpen.value = false;
    return created;
  }

  async function createEntry(title: string, format: 'txt' | 'markdown', commandId: string) {
    const target = newEntry.value!;
    const input = { commandId, workId: workId.value!, parentId: target.parentId, section: view.value!.section, title };
    const entry = await requestCreation(
      'createEntry',
      target.kind === 'directory'
        ? { ...input, kind: 'directory' }
        : { ...input, kind: 'document', format, content: '' }
    );
    await refreshEntries();
    newEntry.value = null;
    return entry;
  }

  async function move(entry: Entry, parentId: string | null, beforeEntryId: string | null) {
    await requestCreation('moveEntry', {
      commandId: crypto.randomUUID(),
      workId: workId.value!,
      entryId: entry.id,
      expectedParentId: entry.parentId,
      expectedPosition: entry.position,
      parentId,
      beforeEntryId
    });
    await refreshEntries();
  }

  onScopeDispose(() => {
    offEvent?.();
    offDisconnect?.();
  });
  return {
    works,
    entries,
    pendingChanges,
    pendingEntryIds,
    state,
    workId,
    work,
    view,
    libraryOpen,
    connected,
    busy,
    error,
    stateError,
    newWorkOpen,
    newEntry,
    importOpen,
    exportOpen,
    connect,
    onEvent,
    refreshLibrary,
    refreshEntries,
    viewFor,
    persistState,
    openWork,
    showLibrary,
    trashWork,
    createWork,
    createEntry,
    move
  };
});
