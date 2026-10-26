import type { EditorState } from '@codemirror/state';
import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';

import type {
  CreationEvent,
  DeliverySummary,
  ReviewRange,
  ReviewTarget,
  ReviewView
} from '@chaptale/creation/contracts';

import { requestCreation, useCreationStore } from '@/features/creation';
import { toErrorMessage } from '@/utils/desktop-api';

import { serializeLike } from './chunk-range';
import { createReviewState } from './state';

export interface ReviewTab {
  changeId: string;
  sessionId: string;
  workId: string;
  entryId: string;
  title: string;
  review: ReviewView | null;
  status: 'loading' | 'ready' | 'error';
  error: string;
  dirty: boolean;
  busy: boolean;
  /** 作者有未保存手改时候选又被更新；保存会因版本不符失败，需重新读取。 */
  outdated: boolean;
  /** 服务端候选更新后递增，审阅面板据此重建编辑器。 */
  generation: number;
}

export function reviewTarget(review: ReviewView): ReviewTarget {
  return {
    changeId: review.change.id,
    expectedVersion: review.change.version,
    expectedRevisionId: review.current?.revisionId ?? null,
    expectedLocation: review.current ? { parentId: review.current.parentId, position: review.current.position } : null
  };
}

function editorFocused() {
  return Boolean(document.activeElement?.closest('.editor-pane'));
}

/**
 * 待接受修改的审阅标签与会话交付摘要。
 * 编辑器状态按标签保存在普通 Map 中，标签切换不丢手改；Agent 写入的新修改在后台打开，
 * 仅当作者正在查看该会话且焦点不在编辑区时切到前台。
 */
export const useReviewStore = defineStore('review', () => {
  const creation = useCreationStore();
  const tabs = shallowRef<ReviewTab[]>([]);
  const activeId = ref('');
  const viewingSessionId = ref<string | null>(null);
  const summaries = ref<Record<string, DeliverySummary[]>>({});
  const deliveryErrors = ref<Record<string, string>>({});
  const deliveryBusy = ref<Record<string, boolean>>({});
  const activeTab = computed(() => tabs.value.find(tab => tab.changeId === activeId.value) ?? null);
  const states = new Map<string, EditorState>();
  const ownCommands = new Set<string>();
  const loads = new Map<string, Promise<void>>();

  function find(id: string) {
    return tabs.value.find(tab => tab.changeId === id);
  }
  function patch(id: string, fields: Partial<ReviewTab>) {
    tabs.value = tabs.value.map(tab => (tab.changeId === id ? { ...tab, ...fields } : tab));
  }
  function command() {
    const id = crypto.randomUUID();
    ownCommands.add(id);
    return id;
  }

  function load(id: string): Promise<void> {
    const running = loads.get(id);
    if (running) return running.then(() => load(id));
    const next = (async () => {
      try {
        const review = await requestCreation('readReview', { changeId: id });
        const tab = find(id);
        if (!tab) return;
        if (review.change.status !== 'pending') {
          remove(id);
          return;
        }
        if (tab.dirty) {
          if (tab.review && review.change.version !== tab.review.change.version) patch(id, { outdated: true });
          return;
        }
        states.set(id, createReviewState(review));
        patch(id, {
          review,
          title: review.candidate.title,
          status: 'ready',
          error: '',
          outdated: false,
          generation: tab.generation + 1
        });
      } catch (cause) {
        if (find(id)) patch(id, { status: 'error', error: toErrorMessage(cause) });
      }
    })().finally(() => loads.delete(id));
    loads.set(id, next);
    return next;
  }

  function open(change: { id: string; sessionId: string; workId: string; entryId: string; title: string }) {
    if (!find(change.id))
      tabs.value = [
        ...tabs.value,
        {
          changeId: change.id,
          sessionId: change.sessionId,
          workId: change.workId,
          entryId: change.entryId,
          title: change.title,
          review: null,
          status: 'loading',
          error: '',
          dirty: false,
          busy: false,
          outdated: false,
          generation: 0
        }
      ];
    return load(change.id);
  }
  /** 会话卡片里的「查看」：打开并切到前台。 */
  async function reveal(change: { id: string; sessionId: string; workId: string; entryId: string; title: string }) {
    activeId.value = change.id;
    await open(change);
  }
  function select(id: string) {
    if (find(id)) activeId.value = id;
  }
  function remove(id: string) {
    states.delete(id);
    tabs.value = tabs.value.filter(tab => tab.changeId !== id);
    if (activeId.value === id) activeId.value = '';
  }
  function close(id: string): boolean {
    const tab = find(id);
    if (!tab) return true;
    if (tab.dirty) {
      patch(id, { error: '有未保存的手改，请先保存或撤销后再关闭' });
      return false;
    }
    remove(id);
    return true;
  }

  function getState(id: string) {
    return states.get(id);
  }
  function updateState(id: string, state: EditorState) {
    states.set(id, state);
    const tab = find(id);
    if (!tab?.review) return;
    const dirty = state.doc.toString() !== (tab.review.candidate.content ?? '').replaceAll(/\r\n?/g, '\n');
    if (dirty !== tab.dirty) patch(id, { dirty, error: '' });
  }

  async function act(id: string, operation: (review: ReviewView) => Promise<unknown>) {
    const tab = find(id);
    if (!tab?.review || tab.busy) return;
    patch(id, { busy: true, error: '' });
    try {
      await operation(tab.review);
      if (find(id)) patch(id, { busy: false });
    } catch (cause) {
      if (find(id)) patch(id, { busy: false, error: toErrorMessage(cause) });
    }
    await refreshAfterDecision(id);
  }
  async function refreshAfterDecision(id: string) {
    if (find(id)) await load(id);
    if (viewingSessionId.value) await refreshDeliveries(viewingSessionId.value);
  }

  /** 缺省时整篇接受或拒绝；range 决定正文的一处，title 只决定改名。 */
  function decide(id: string, decision: 'accept' | 'reject', scope?: ReviewRange | 'title') {
    return act(id, review =>
      requestCreation('decideReview', {
        commandId: command(),
        ...reviewTarget(review),
        decision,
        ...(scope === 'title' ? { part: 'title' as const } : scope ? { range: scope } : {})
      })
    );
  }
  /** 保存作者手改；resolveConflicts 表示作者已检查冲突。 */
  function save(id: string, resolveConflicts = false) {
    const tab = find(id);
    if (!tab?.review || (!tab.dirty && !resolveConflicts) || tab.outdated) return Promise.resolve();
    const state = states.get(id)!;
    const content =
      tab.review.candidate.content === null ? null : serializeLike(state.doc, tab.review.candidate.content);
    return act(id, async review => {
      await requestCreation('updateReview', {
        commandId: command(),
        ...reviewTarget(review),
        title: review.candidate.title,
        content,
        resolveConflicts
      });
      if (find(id)) patch(id, { dirty: false });
    });
  }
  /** 放弃手改并读取最新候选。 */
  function discardEdits(id: string) {
    patch(id, { dirty: false, outdated: false, error: '' });
    return load(id);
  }

  /** 目录树对新建候选的整体决定；失败交给调用方显示。 */
  async function decideChange(changeId: string, decision: 'accept' | 'reject') {
    const current = await requestCreation('readReview', { changeId });
    await requestCreation('decideReview', { commandId: command(), ...reviewTarget(current), decision });
    if (viewingSessionId.value) await refreshDeliveries(viewingSessionId.value);
  }
  async function refreshDeliveries(sessionId: string) {
    try {
      const list = await requestCreation('listDeliveries', { sessionId });
      summaries.value = { ...summaries.value, [sessionId]: list };
      deliveryErrors.value = { ...deliveryErrors.value, [sessionId]: '' };
    } catch (cause) {
      deliveryErrors.value = { ...deliveryErrors.value, [sessionId]: toErrorMessage(cause) };
    }
  }
  async function deliveryAction(sessionId: string, operation: () => Promise<string[]>) {
    if (deliveryBusy.value[sessionId]) return;
    deliveryBusy.value = { ...deliveryBusy.value, [sessionId]: true };
    deliveryErrors.value = { ...deliveryErrors.value, [sessionId]: '' };
    let failures: string[];
    try {
      failures = await operation();
    } catch (cause) {
      failures = [toErrorMessage(cause)];
    }
    deliveryBusy.value = { ...deliveryBusy.value, [sessionId]: false };
    await refreshDeliveries(sessionId);
    if (failures.length) deliveryErrors.value = { ...deliveryErrors.value, [sessionId]: failures.join('\n') };
    for (const tab of tabs.value) if (tab.sessionId === sessionId && !tab.dirty) void load(tab.changeId);
  }
  /** 整组决定按作品逐部提交，每部作品在自己的事务内全部成功或全部不变。 */
  function decideGroup(summary: DeliverySummary, decision: 'accept' | 'reject') {
    return deliveryAction(summary.group.sessionId, async () => {
      const failures: string[] = [];
      const workIds = [...new Set(summary.items.map(item => item.workId))];
      for (const workId of workIds) {
        try {
          await requestCreation('decideDelivery', {
            commandId: command(),
            groupId: summary.group.id,
            workId,
            decision,
            targets: summary.items.filter(item => item.workId === workId).map(item => item.target)
          });
        } catch (cause) {
          const title = creation.works.find(work => work.id === workId)?.title;
          failures.push(workIds.length > 1 && title ? `《${title}》：${toErrorMessage(cause)}` : toErrorMessage(cause));
        }
      }
      return failures;
    });
  }
  function endTask(summary: DeliverySummary) {
    return deliveryAction(summary.group.sessionId, async () => {
      await requestCreation('endDelivery', {
        commandId: command(),
        sessionId: summary.group.sessionId,
        groupId: summary.group.id,
        expectedVersion: summary.group.version
      });
      return [];
    });
  }

  function handle(event: CreationEvent) {
    const own = ownCommands.delete(event.commandId);
    const { change } = event;
    if (change.kind === 'review') {
      const pending = change.change;
      if (viewingSessionId.value === pending.sessionId) void refreshDeliveries(pending.sessionId);
      if (find(pending.id)) {
        if (pending.status !== 'pending' && !find(pending.id)!.dirty) remove(pending.id);
        else if (!own) void load(pending.id);
        return;
      }
      if (own || pending.status !== 'pending' || pending.workId !== creation.workId) return;
      void open({ ...pending, title: pending.candidate.title });
      if (viewingSessionId.value === pending.sessionId && !editorFocused()) activeId.value = pending.id;
      return;
    }
    if (change.kind === 'delivery') {
      if (viewingSessionId.value === change.group.sessionId) void refreshDeliveries(change.group.sessionId);
      return;
    }
    if (change.kind === 'work' || event.cursor.workId !== creation.workId) return;
    // 正式稿变化会改变冲突与可接受状态。
    const ids = change.kind === 'entries' ? change.entries.map(entry => entry.id) : [change.entry.id];
    for (const tab of tabs.value) if (ids.includes(tab.entryId) && !tab.dirty) void load(tab.changeId);
    if (viewingSessionId.value) void refreshDeliveries(viewingSessionId.value);
  }
  const offEvent = creation.onEvent(handle);

  watch(viewingSessionId, id => {
    if (id) void refreshDeliveries(id);
  });
  watch(
    () => creation.workId,
    () => {
      states.clear();
      tabs.value = [];
      activeId.value = '';
    }
  );
  /** 切换作品或关闭窗口前由编辑区检查；未保存手改留在当前标签。 */
  function confirmLeave(): boolean {
    const dirty = tabs.value.find(tab => tab.dirty);
    if (!dirty) return true;
    activeId.value = dirty.changeId;
    patch(dirty.changeId, { error: '有未保存的手改，请先保存或撤销' });
    return false;
  }
  onScopeDispose(() => {
    offEvent();
  });

  return {
    tabs,
    activeId,
    activeTab,
    viewingSessionId,
    summaries,
    deliveryErrors,
    deliveryBusy,
    open,
    reveal,
    select,
    close,
    getState,
    updateState,
    decide,
    save,
    discardEdits,
    decideChange,
    refreshDeliveries,
    decideGroup,
    endTask,
    confirmLeave,
    hasUnsaved: computed(() => tabs.value.some(tab => tab.dirty))
  };
});
