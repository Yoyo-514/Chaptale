import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref } from 'vue';

import type { HistoryItem, HostEvent, HostState, ModelRef, SessionView, EditMode } from '@chaptale/agent-host/protocol';

import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

/** 界面只持有快照、草稿和查看位置；原生会话由宿主持有。 */
export const useAgentStore = defineStore('agent', () => {
  const state = ref<HostState>();
  const connected = ref(false);
  const connecting = ref(false);
  const error = ref('');
  const activeId = ref(localStorage.getItem('chaptale.agent.active') ?? undefined);
  const drafts = ref<Record<string, string>>({});
  const composeCwd = ref<string>();
  const selectedModel = ref<ModelRef>();
  const composeInstructions = ref<string>();
  const composeMode = ref<EditMode>();
  const history = ref<HistoryItem[]>([]);
  const active = computed(() => state.value?.sessions.find(session => session.id === activeId.value));
  const draft = computed({
    get: () => drafts.value[activeId.value ?? 'new'] ?? '',
    set: (text: string) => {
      drafts.value[activeId.value ?? 'new'] = text;
    }
  });
  let connection: Promise<void> | undefined;
  let offEvents: (() => void) | undefined;
  let offDisconnected: (() => void) | undefined;

  function apply(event: HostEvent) {
    const snapshot = state.value!;
    if (event.cursor <= snapshot.cursor) return;
    snapshot.cursor = event.cursor;
    switch (event.kind) {
      case 'session': {
        const index = snapshot.sessions.findIndex(session => session.id === event.session.id);
        if (index === -1) snapshot.sessions.push(event.session);
        else snapshot.sessions[index] = event.session;
        break;
      }
      case 'message':
        snapshot.sessions.find(session => session.id === event.id)!.messages[event.index] = event.message;
        break;
      case 'delta':
        snapshot.sessions.find(session => session.id === event.id)!.messages[event.index][event.field] += event.text;
        break;
      case 'running': {
        const session = snapshot.sessions.find(session => session.id === event.id)!;
        session.running = event.running;
        session.error = event.error;
        break;
      }
      case 'closed':
        snapshot.sessions = snapshot.sessions.filter(session => session.id !== event.id);
        break;
      case 'approval':
        snapshot.approvals.push(event.approval);
        break;
      case 'approval-closed':
        snapshot.approvals = snapshot.approvals.filter(approval => approval.id !== event.id);
        break;
      case 'models':
        snapshot.models = event.models;
        break;
      case 'settings':
        snapshot.settings = event.settings;
        break;
    }
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
    connection = client
      .request('state', undefined)
      .then(snapshot => {
        state.value = snapshot;
        if (composeMode.value === undefined) composeMode.value = snapshot.settings.defaultMode;
        for (const event of buffered) apply(event);
        syncing = false;
        connected.value = true;
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

  function select(id: string) {
    activeId.value = id;
    localStorage.setItem('chaptale.agent.active', id);
  }

  function newDraft(cwd?: string) {
    activeId.value = undefined;
    composeCwd.value = cwd;
    composeInstructions.value = undefined;
    composeMode.value = state.value?.settings.defaultMode;
    localStorage.removeItem('chaptale.agent.active');
  }

  function compose(cwd: string, prompt: string, files: string[]) {
    if (active.value?.cwd !== cwd) newDraft(cwd);
    draft.value = [prompt, ...files.map(file => `文件：${file}`)].join('\n');
  }

  async function create(instructions = composeInstructions.value) {
    const text = draft.value;
    return perform(async () => {
      const { provider, id: modelId } = selectedModel.value!;
      const id = await getDesktopApi().agentHost.request('create', {
        model: { provider, id: modelId },
        cwd: composeCwd.value,
        instructions
      });
      drafts.value[id] = text;
      delete drafts.value.new;
      select(id);
      if (composeMode.value !== active.value!.mode) {
        await getDesktopApi().agentHost.request('mode', { id, mode: composeMode.value! });
      }
    });
  }

  async function send() {
    const text = draft.value.trim();
    if (!text) return;
    if (!active.value) {
      if (!selectedModel.value) {
        error.value = '请先选择模型';
        return;
      }
      if (!(await create())) return;
    }
    const id = activeId.value!;
    draft.value = '';
    const sent = await perform(() => getDesktopApi().agentHost.request('prompt', { id, text }));
    if (!sent && !drafts.value[id]) drafts.value[id] = text;
  }

  async function loadHistory(cwd?: string) {
    await perform(async () => {
      history.value = await getDesktopApi().agentHost.request('history', cwd ? { cwd } : undefined);
    });
  }

  async function open(item: HistoryItem) {
    await perform(async () =>
      select(await getDesktopApi().agentHost.request('open', { file: item.file, cwd: item.cwd }))
    );
  }

  function title(session: SessionView): string {
    return (
      session.messages.find(message => message.role === 'user' && message.text)?.text.slice(0, 32) ||
      `会话 ${(state.value?.sessions.findIndex(item => item.id === session.id) ?? 0) + 1}`
    );
  }

  onScopeDispose(() => {
    offEvents?.();
    offDisconnected?.();
  });
  return {
    state,
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
    loadHistory,
    open,
    title
  };
});
