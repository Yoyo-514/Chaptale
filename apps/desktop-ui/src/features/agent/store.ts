import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, watch } from 'vue';

import type { HistoryItem, HostEvent, HostState, ModelRef, EditMode } from '@chaptale/agent-host/protocol';
import type { SessionState } from '@chaptale/creation/contracts';

import { requestCreation, useCreationStore } from '@/features/creation';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { applyHostEvent } from './session/host-events';
import { type SessionEntry, sessionEntries, sessionTitle } from './session/list';
import { enqueueMessage, type OutgoingMessage, unsentMessages } from './session/outgoing';

export type { OutgoingMessage } from './session/outgoing';
export type { SessionEntry } from './session/list';

/** 界面只持有快照、草稿和查看位置；原生会话由宿主持有。 */
export const useAgentStore = defineStore('agent', () => {
  const creation = useCreationStore();
  const state = ref<HostState>();
  const catalog = ref<SessionState>({ assignments: [], selections: [] });
  const scope = ref<string | null>(creation.workId);
  const creating = ref(false);
  const connected = ref(false);
  const connecting = ref(false);
  const error = ref('');
  const activeId = ref<string>();
  const drafts = ref<Record<string, string>>({});
  const outgoing = ref<Record<string, OutgoingMessage[]>>({});
  const composeCwd = ref<string>();
  const selectedModel = ref<ModelRef>();
  const composeInstructions = ref<string>();
  const composeMode = ref<EditMode>();
  const history = ref<HistoryItem[]>([]);
  const active = computed(() => state.value?.sessions.find(session => session.id === activeId.value));
  const activeOutgoing = computed(() => (active.value ? unsent(active.value.id) : []));
  const draftKey = computed(() => activeId.value ?? `new:${scope.value ?? ''}`);
  const entries = computed(() => sessionEntries(history.value, state.value?.sessions ?? [], owner));
  const recent = computed(() => entries.value.filter(entry => entry.workId === scope.value).slice(0, 5));
  const draft = computed({
    get: () => drafts.value[draftKey.value] ?? '',
    set: (text: string) => {
      drafts.value[draftKey.value] = text;
    }
  });
  // 查看请求防止迟到的打开结果抢回界面；每个范围的选择版本保留用户的后续选择。
  let viewVersion = 0;
  const choices = new Map<string | null, number>();
  function choose(workId: string | null): number {
    const version = (choices.get(workId) ?? 0) + 1;
    choices.set(workId, version);
    return version;
  }
  const owners = computed(() => new Map(catalog.value.assignments.map(item => [item.sessionId, item.workId])));
  function owner(sessionId: string | null): string | null {
    return sessionId === null ? null : (owners.value.get(sessionId) ?? null);
  }
  async function remember(workId: string | null, sessionId: string | null) {
    catalog.value = await requestCreation('selectSession', { workId, sessionId });
  }
  function resetCompose() {
    composeCwd.value = undefined;
    composeInstructions.value = undefined;
    composeMode.value = state.value?.settings.defaultMode;
  }
  async function changeScope(workId: string | null) {
    const version = ++viewVersion;
    scope.value = workId;
    activeId.value = undefined;
    resetCompose();
    if (!connected.value) return;
    await perform(async () => {
      const selected = catalog.value.selections.find(item => item.workId === workId)?.sessionId;
      if (!selected) return;
      const live = state.value!.sessions.find(session => session.sessionId === selected);
      if (live) {
        activeId.value = live.id;
        return;
      }
      const item = history.value.find(candidate => candidate.id === selected);
      if (!item) throw new Error('上次选中的会话历史未找到，请在历史列表中选择其他会话');
      const id = await getDesktopApi().agentHost.request('open', { file: item.file, cwd: item.cwd });
      if (version === viewVersion) activeId.value = id;
    });
  }
  let connection: Promise<void> | undefined;
  let offEvents: (() => void) | undefined;
  let offDisconnected: (() => void) | undefined;

  function apply(event: HostEvent) {
    applyHostEvent(state.value!, event);
  }

  function connect(): Promise<void> {
    if (connected.value) return Promise.resolve();
    if (connection) return connection;
    connecting.value = true;
    connected.value = false;
    error.value = '';
    offEvents?.();
    offDisconnected?.();
    const client = getDesktopApi().agentHost;
    const buffered: HostEvent[] = [];
    let syncing = true;
    // 先订阅再取快照，期间事件按游标补上；查看不会重发请求或新建会话。
    offEvents = client.subscribe(event => (syncing ? buffered.push(event) : apply(event)));
    offDisconnected = client.onDisconnected(message => {
      connected.value = false;
      error.value = message;
    });
    connection = Promise.all([
      client.request('state', undefined),
      requestCreation('readSessionState', {}),
      client.request('history', undefined)
    ])
      .then(async ([snapshot, ownership, items]) => {
        state.value = snapshot;
        catalog.value = ownership;
        history.value = items;
        if (composeMode.value === undefined) composeMode.value = snapshot.settings.defaultMode;
        for (const event of buffered) apply(event);
        syncing = false;
        connected.value = true;
        await changeScope(scope.value);
      })
      .catch(cause => {
        error.value = toErrorMessage(cause);
      })
      .finally(() => {
        connecting.value = false;
        connection = undefined;
      });
    return connection;
  }

  async function perform(operation: () => Promise<unknown>): Promise<boolean> {
    error.value = '';
    try {
      await operation();
      return true;
    } catch (cause) {
      error.value = toErrorMessage(cause);
      return false;
    }
  }

  async function select(id: string) {
    ++viewVersion;
    const session = state.value!.sessions.find(item => item.id === id)!;
    const workId = owner(session.sessionId);
    choose(workId);
    scope.value = workId;
    activeId.value = id;
    return perform(() => remember(workId, session.sessionId));
  }

  async function newDraft(cwd?: string, independent = false) {
    ++viewVersion;
    const workId = independent ? null : creation.workId;
    choose(workId);
    scope.value = workId;
    activeId.value = undefined;
    resetCompose();
    composeCwd.value = cwd;
    return perform(() => remember(workId, null));
  }

  function compose(cwd: string, prompt: string, files: string[]) {
    if (active.value?.cwd !== cwd) newDraft(cwd);
    draft.value = [prompt, ...files.map(file => `文件：${file}`)].join('\n');
  }

  async function create(instructions = composeInstructions.value): Promise<string | undefined> {
    const workId = scope.value;
    const key = draftKey.value;
    const version = viewVersion;
    const choice = choose(workId);
    const mode = composeMode.value!;
    let createdId: string | undefined;
    creating.value = true;
    const success = await perform(async () => {
      const { provider, id: modelId } = selectedModel.value!;
      const client = getDesktopApi().agentHost;
      const id = await client.request('create', {
        model: { provider, id: modelId },
        cwd: composeCwd.value,
        instructions
      });
      if (workId !== null) {
        try {
          catalog.value = await requestCreation('assignSession', { sessionId: id, workId });
        } catch (cause) {
          await client.request('close', { id });
          throw cause;
        }
      }
      const session = state.value!.sessions.find(item => item.id === id)!;
      if (mode !== session.mode) await client.request('mode', { id, mode });
      if (choices.get(workId) === choice) await remember(workId, id);
      drafts.value[id] = drafts.value[key] ?? '';
      delete drafts.value[key];
      if (version === viewVersion) activeId.value = id;
      createdId = id;
    });
    creating.value = false;
    return success ? createdId : undefined;
  }

  async function send() {
    if (active.value?.compacting || creating.value) return;
    const text = draft.value.trim();
    if (!text) return;
    let id = activeId.value;
    if (!id) {
      if (!selectedModel.value) {
        error.value = '请先选择模型';
        return;
      }
      id = await create();
      if (!id) return;
    }
    drafts.value[id] = '';
    await dispatch(id, text);
  }

  function liveSession(id: string) {
    return state.value!.sessions.find(item => item.id === id)!;
  }
  function unsent(id: string) {
    return unsentMessages(liveSession(id), outgoing.value[id]);
  }
  /** 先显示消息再请求；宿主拒收时保留消息并标记失败，供作者重试或移除。 */
  async function dispatch(id: string, text: string) {
    const { message, list } = enqueueMessage(liveSession(id), outgoing.value[id] ?? [], text);
    outgoing.value[id] = list;
    try {
      await getDesktopApi().agentHost.request('prompt', { id, text });
    } catch (cause) {
      const failed = outgoing.value[id].find(item => item.key === message.key);
      if (failed) failed.error = toErrorMessage(cause);
    }
  }
  function discardOutgoing(key: string) {
    const id = activeId.value!;
    outgoing.value[id] = outgoing.value[id].filter(item => item.key !== key);
  }
  function retryOutgoing(key: string) {
    const id = activeId.value!;
    const { text } = outgoing.value[id].find(item => item.key === key)!;
    discardOutgoing(key);
    return dispatch(id, text);
  }

  /** 宿主拒绝待审修改并关闭会话，历史文件移入回收站后刷新列表。 */
  async function deleteSessions(sessionIds: string[]) {
    const deleted = await perform(async () => {
      await getDesktopApi().agentHost.request('deleteSessions', { sessionIds });
      catalog.value = await requestCreation('readSessionState', {});
    });
    if (deleted) await loadHistory();
    return deleted;
  }

  async function loadHistory() {
    return perform(async () => {
      history.value = await getDesktopApi().agentHost.request('history', undefined);
    });
  }

  async function open(item: HistoryItem) {
    const workId = owner(item.id);
    const choice = choose(workId);
    const version = ++viewVersion;
    return perform(async () => {
      const id = await getDesktopApi().agentHost.request('open', { file: item.file, cwd: item.cwd });
      if (choices.get(workId) === choice) await remember(workId, item.id);
      if (version === viewVersion) {
        scope.value = workId;
        activeId.value = id;
      }
    });
  }

  async function assign(sessionId: string) {
    const workId = creation.workId!;
    const version = viewVersion;
    return perform(async () => {
      catalog.value = await requestCreation('assignSession', { sessionId, workId });
      if (version !== viewVersion) return;
      const live = state.value!.sessions.find(session => session.sessionId === sessionId);
      if (live) await select(live.id);
      else await changeScope(workId);
    });
  }

  async function rename(id: string, name: string) {
    return perform(() => getDesktopApi().agentHost.request('rename', { id, name }));
  }

  async function view(entry: SessionEntry) {
    return entry.live ? select(entry.live.id) : open(entry.item!);
  }

  watch(
    () => creation.workId,
    workId => {
      void changeScope(workId);
    }
  );
  // 永久清空作品后其会话转为未归属，重新读取归属。
  const offLibrary = creation.onEvent(event => {
    if (event.change.kind !== 'library') return;
    void requestCreation('readSessionState', {}).then(
      next => {
        catalog.value = next;
      },
      cause => {
        error.value = toErrorMessage(cause);
      }
    );
  });

  onScopeDispose(() => {
    offLibrary();
    offEvents?.();
    offDisconnected?.();
  });
  return {
    state,
    catalog,
    scope,
    creating,
    entries,
    recent,
    rename,
    view,
    owner,
    changeScope,
    assign,
    connected,
    connecting,
    error,
    activeId,
    active,
    draft,
    composeCwd,
    selectedModel,
    history,
    composeInstructions,
    composeMode,
    connect,
    perform,
    select,
    newDraft,
    compose,
    create,
    send,
    deleteSessions,
    activeOutgoing,
    retryOutgoing,
    discardOutgoing,
    loadHistory,
    open,
    title: sessionTitle
  };
});
