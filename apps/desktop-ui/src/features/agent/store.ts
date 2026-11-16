import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';

import type {
  EditorContext,
  HistoryItem,
  HostEvent,
  HostState,
  ModelRef,
  QueuedDelivery,
  EditMode
} from '@chaptale/agent-host/protocol';
import type { SessionState } from '@chaptale/creation/contracts';

import { requestCreation, useCreationStore } from '@/features/creation';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { applyHostEvent } from './session/host-events';
import { type SessionEntry, sessionEntries, sessionTitle } from './session/list';
import { enqueueMessage, type OutgoingMessage, unsentMessages } from './session/outgoing';
import { useComposerQuotes } from './session/quotes';

export type { OutgoingMessage } from './session/outgoing';
export type { SessionEntry } from './session/list';

interface EditorContextSource {
  prepare(sessionId: string | null, quoted?: EditorContext): Promise<{ ok: boolean; context?: EditorContext }>;
}

/** 界面只持有快照、草稿和查看位置；原生会话由宿主持有。 */
export const useAgentStore = defineStore('agent', () => {
  const creation = useCreationStore();
  const state = ref<HostState>();
  const catalog = ref<SessionState>({ selections: [] });
  const scope = ref<string | null>(creation.workId);
  const creating = ref(false);
  const connected = ref(false);
  const connecting = ref(false);
  const error = ref('');
  const activeId = ref<string>();
  const drafts = ref<Record<string, string>>({});
  const outgoing = ref<Record<string, OutgoingMessage[]>>({});
  const selectedModel = ref<ModelRef>();
  const composeInstructions = ref<string>();
  const composeMode = ref<EditMode>();
  const history = ref<HistoryItem[]>([]);
  const editorContextSource = shallowRef<EditorContextSource>();
  function setEditorContextSource(source: EditorContextSource | undefined) {
    editorContextSource.value = source;
  }
  const active = computed(() => state.value?.sessions.find(session => session.id === activeId.value));
  const activeOutgoing = computed(() => (active.value ? unsent(active.value.id) : []));
  const draftKey = computed(() => activeId.value ?? `new:${scope.value ?? ''}`);
  const quotes = useComposerQuotes(draftKey);
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
  // 归属由宿主按历史文件所在目录给出；打开的会话以视图为准。
  const owners = computed(() => {
    const map = new Map<string, string | null>(history.value.map(item => [item.id, item.workId]));
    for (const session of state.value?.sessions ?? [])
      if (session.sessionId) map.set(session.sessionId, session.workId);
    return map;
  });
  function owner(sessionId: string | null): string | null {
    return sessionId === null ? null : (owners.value.get(sessionId) ?? null);
  }
  async function remember(workId: string | null, sessionId: string | null) {
    catalog.value = await requestCreation('selectSession', { workId, sessionId });
  }
  /** 新会话沿用最近一次选择的模型；它已从配置中删除时保留草稿当前的选择。 */
  function resetCompose() {
    composeInstructions.value = undefined;
    composeMode.value = state.value?.settings.defaultMode;
    const last = state.value?.settings.lastModel;
    if (last && state.value!.models.some(item => item.provider === last.provider && item.id === last.id))
      selectedModel.value = { ...last };
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
      const id = await getDesktopApi().agentHost.request('open', { file: item.file });
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

  async function dismissError() {
    error.value = '';
    const id = activeId.value;
    const target = id ? state.value?.sessions.find(item => item.id === id) : undefined;
    if (target && (target.error || target.noticeLevel)) {
      delete target.error;
      delete target.noticeLevel;
      if (connected.value) {
        await getDesktopApi()
          .agentHost.request('dismissError', { id: target.id })
          .catch(() => undefined);
      }
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

  async function newDraft(independent = false) {
    ++viewVersion;
    const workId = independent ? null : creation.workId;
    choose(workId);
    scope.value = workId;
    activeId.value = undefined;
    resetCompose();
    return perform(() => remember(workId, null));
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
      // 宿主创建会话时完成作品归属。
      const id = await client.request('create', { model: { provider, id: modelId }, workId, instructions });
      const session = state.value!.sessions.find(item => item.id === id)!;
      if (mode !== session.mode) await client.request('mode', { id, mode });
      if (choices.get(workId) === choice) await remember(workId, id);
      else catalog.value = await requestCreation('readSessionState', {});
      drafts.value[id] = drafts.value[key] ?? '';
      delete drafts.value[key];
      quotes.migrate(key, id);
      if (version === viewVersion) activeId.value = id;
      createdId = id;
    });
    creating.value = false;
    return success ? createdId : undefined;
  }

  async function send(delivery: QueuedDelivery = 'steer') {
    if (active.value?.compacting || creating.value) return;
    const text = draft.value.trim();
    if (!text) return;
    if (!activeId.value && !selectedModel.value) {
      error.value = '请先选择模型';
      return;
    }
    const quoted = quotes.current.value;
    const prepared = editorContextSource.value
      ? await editorContextSource.value.prepare(active.value?.sessionId ?? null, quoted)
      : { ok: true as const, context: quoted };
    if (!prepared.ok) return;
    let id = activeId.value;
    if (!id) {
      id = await create();
      if (!id) return;
    }
    const queuing = liveSession(id).running ? delivery : undefined;
    drafts.value[id] = '';
    quotes.clear(id);
    await dispatch(id, text, prepared.context, queuing);
  }

  /** 新建归属当前作品的审阅模式会话并发送作者可见的指令。 */
  async function startReview(prompt: string) {
    await newDraft();
    composeMode.value = 'review';
    draft.value = prompt;
    await send();
  }

  function liveSession(id: string) {
    return state.value!.sessions.find(item => item.id === id)!;
  }
  function unsent(id: string) {
    return unsentMessages(liveSession(id), outgoing.value[id]);
  }
  /** 先显示消息再请求；宿主拒收时保留消息并标记失败，供作者重试或移除。 */
  async function dispatch(id: string, text: string, context?: EditorContext, delivery?: QueuedDelivery) {
    // 重试消息来自响应式待发列表，同样按纯 JSON 契约生成本次请求自己的数据。
    const capturedContext = context && (JSON.parse(JSON.stringify(context)) as EditorContext);
    const { message, list } = enqueueMessage(
      liveSession(id),
      outgoing.value[id] ?? [],
      text,
      capturedContext,
      delivery
    );
    outgoing.value[id] = list;
    try {
      await getDesktopApi().agentHost.request('prompt', {
        id,
        text,
        editorContext: capturedContext,
        ...(delivery && { delivery })
      });
      if (delivery) {
        outgoing.value[id] = (outgoing.value[id] ?? []).filter(item => item.key !== message.key);
      }
    } catch (cause) {
      const failed = outgoing.value[id].find(item => item.key === message.key);
      if (failed) {
        failed.queuedInflight = false;
        failed.error = toErrorMessage(cause);
      }
    }
  }
  function discardOutgoing(key: string) {
    const id = activeId.value!;
    outgoing.value[id] = outgoing.value[id].filter(item => item.key !== key);
  }
  function retryOutgoing(key: string) {
    const id = activeId.value!;
    const { text, editorContext: context, delivery } = outgoing.value[id].find(item => item.key === key)!;
    discardOutgoing(key);
    const queuing = liveSession(id).running ? (delivery ?? 'steer') : undefined;
    return dispatch(id, text, context, queuing);
  }

  /** 撤回尚未被模型读取的排队消息，并把正文与选区引用填回输入框供作者修改。 */
  async function recallQueued(delivery: QueuedDelivery, index: number) {
    const id = activeId.value;
    if (!id) return;
    await perform(async () => {
      const removed = await getDesktopApi().agentHost.request('dequeue', { id, delivery, index });
      if (!removed) return;
      const existing = drafts.value[id]?.trim() ?? '';
      drafts.value[id] = existing ? `${removed.text}\n${existing}` : removed.text;
      if (removed.editorContext?.selection && !quotes.current.value) quotes.set(removed.editorContext);
      else quotes.focus();
    });
  }

  function editMessage(entryId: string, text: string, context?: EditorContext, discardPending = false) {
    const id = activeId.value!;
    const capturedContext = context && (JSON.parse(JSON.stringify(context)) as EditorContext);
    return perform(() =>
      getDesktopApi().agentHost.request('editMessage', {
        id,
        entryId,
        text,
        editorContext: capturedContext,
        discardPending
      })
    );
  }

  function switchBranch(leafId: string, discardPending = false) {
    const id = activeId.value!;
    return perform(() => getDesktopApi().agentHost.request('switchBranch', { id, leafId, discardPending }));
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
      const id = await getDesktopApi().agentHost.request('open', { file: item.file });
      if (choices.get(workId) === choice) await remember(workId, item.id);
      if (version === viewVersion) {
        scope.value = workId;
        activeId.value = id;
      }
    });
  }

  /** 宿主移动历史文件；已打开的会话关闭后以新句柄重新打开。 */
  async function assign(sessionId: string) {
    const workId = creation.workId!;
    const version = viewVersion;
    return perform(async () => {
      const client = getDesktopApi().agentHost;
      const reopened = await client.request('assignSession', { sessionId, workId });
      const [next, items] = await Promise.all([
        requestCreation('readSessionState', {}),
        client.request('history', undefined)
      ]);
      catalog.value = next;
      history.value = items;
      if (version !== viewVersion) return;
      if (reopened) await select(reopened);
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
  // 永久删除作品会清除查看位置并移走其会话历史，重新读取两者。
  const offLibrary = creation.onEvent(event => {
    if (event.change.kind !== 'library') return;
    void Promise.all([
      requestCreation('readSessionState', {}),
      getDesktopApi().agentHost.request('history', undefined)
    ]).then(
      ([next, items]) => {
        catalog.value = next;
        history.value = items;
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
    setEditorContextSource,
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
    dismissError,
    activeId,
    active,
    draft,
    quotedSelection: quotes.current,
    composerFocusVersion: quotes.focusVersion,
    quoteSelection: quotes.set,
    clearQuote: quotes.clear,
    selectedModel,
    history,
    composeInstructions,
    composeMode,
    connect,
    perform,
    select,
    newDraft,
    create,
    send,
    editMessage,
    switchBranch,
    startReview,
    deleteSessions,
    activeOutgoing,
    retryOutgoing,
    discardOutgoing,
    recallQueued,
    loadHistory,
    open,
    title: sessionTitle
  };
});
