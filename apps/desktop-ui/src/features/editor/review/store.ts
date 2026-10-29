import type { EditorState } from '@codemirror/state';
import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';

import type {
  CreationEvent,
  DeliverySummary,
  Entry,
  EntryChange,
  EntryReviewView,
  PendingChange,
  RecordChange,
  RecordFields,
  ReviewRange,
  ReviewTarget,
  ReviewView
} from '@chaptale/creation/contracts';

import { requestCreation, useCreationStore } from '@/features/creation';
import { toErrorMessage } from '@/utils/desktop-api';

import { serializeLike } from './chunk-range';
import { createReviewState } from './state';

/**
 * 一个会话对一个条目的审阅标签：文稿只有条目自身的修改；资料还列出本会话涉及它的事件候选。
 */
export interface ReviewTab {
  key: string;
  sessionId: string;
  workId: string;
  entryId: string;
  title: string;
  section: Entry['section'];
  /** 条目自身的待接受修改；只有事件候选时为 null。 */
  review: EntryReviewView | null;
  records: RecordChange[];
  status: 'loading' | 'ready' | 'error';
  error: string;
  dirty: boolean;
  busy: boolean;
  /** 作者有未保存手改时候选又被更新；保存会因版本不符失败，需重新读取。 */
  outdated: boolean;
  /** 服务端候选更新后递增，审阅面板据此重建编辑器。 */
  generation: number;
}

export function reviewTarget(review: EntryReviewView): ReviewTarget {
  return {
    changeId: review.change.id,
    expectedVersion: review.change.version,
    expectedRevisionId: review.current?.revisionId ?? null,
    expectedLocation: review.current ? { parentId: review.current.parentId, position: review.current.position } : null
  };
}

/** 读取的审阅对象应是条目修改；事件候选随资料标签列出，不单独读取。 */
function entryReview(view: ReviewView): EntryReviewView {
  if (view.change.target !== 'entry') throw new Error('审阅目标类型错误');
  return view as EntryReviewView;
}

function editorFocused() {
  return Boolean(document.activeElement?.closest('.editor-pane'));
}

const tabKey = (sessionId: string, entryId: string) => `${sessionId}:${entryId}`;

/** 事件候选涉及的资料：候选与修改前的并集，移除关联的资料也要看到这条修改。 */
export function recordResources(change: RecordChange): string[] {
  return [...new Set([...change.candidate.resourceIds, ...(change.base?.resourceIds ?? [])])];
}

/** 候选所在的审阅标签：条目修改归条目自身，事件归第一份涉及的资料。 */
function changeEntryId(change: PendingChange) {
  return change.target === 'entry' ? change.targetId : change.candidate.resourceIds[0];
}

/**
 * 待接受修改的审阅标签与会话交付摘要。
 * 编辑器状态按标签保存在普通 Map 中，标签切换不丢手改；Agent 写入的新修改在后台打开，
 * 仅当作者正在查看该会话且焦点不在编辑区时切到前台。资料区修改一次只在后台打开一份资料。
 */
export const useReviewStore = defineStore('review', () => {
  const creation = useCreationStore();
  const tabs = shallowRef<ReviewTab[]>([]);
  const activeId = ref('');
  const viewingSessionId = ref<string | null>(null);
  const summaries = ref<Record<string, DeliverySummary[]>>({});
  const deliveryErrors = ref<Record<string, string>>({});
  const deliveryBusy = ref<Record<string, boolean>>({});
  const activeTab = computed(() => tabs.value.find(tab => tab.key === activeId.value) ?? null);
  const states = new Map<string, EditorState>();
  const ownCommands = new Set<string>();
  const loads = new Map<string, Promise<void>>();

  function find(key: string) {
    return tabs.value.find(tab => tab.key === key);
  }
  function patch(key: string, fields: Partial<ReviewTab>) {
    tabs.value = tabs.value.map(tab => (tab.key === key ? { ...tab, ...fields } : tab));
  }
  function command() {
    const id = crypto.randomUUID();
    ownCommands.add(id);
    return id;
  }
  function entryTitle(entryId: string) {
    return (
      creation.entries.find(entry => entry.id === entryId)?.title ??
      creation.pendingEntries.find(change => change.targetId === entryId)?.candidate.title ??
      ''
    );
  }

  /** 资料自身没有候选或候选被接受时，正式资料仍在。 */
  async function kept(tab: ReviewTab) {
    const previous = tab.review?.change;
    if (!previous) return true;
    const { change } = await requestCreation('readReview', { changeId: previous.id });
    return change.status === 'accepted' && !previous.deleted;
  }
  function load(key: string): Promise<void> {
    const running = loads.get(key);
    if (running) return running.then(() => load(key));
    const next = (async () => {
      try {
        const tab = find(key);
        if (!tab) return;
        const changes = await requestCreation('listPendingChanges', { workId: tab.workId, sessionId: tab.sessionId });
        const own = changes.find(
          (change): change is EntryChange => change.target === 'entry' && change.targetId === tab.entryId
        );
        const records = changes.filter(
          (change): change is RecordChange =>
            change.target === 'record' && recordResources(change).includes(tab.entryId)
        );
        const review = own ? entryReview(await requestCreation('readReview', { changeId: own.id })) : null;
        if (!find(key)) return;
        // 文稿处理完即关闭；资料留在标签上提示下一份，资料的新建或修改被拒绝、删除被接受后关闭。
        if (!review && !records.length && (tab.section === 'manuscript' || !(await kept(tab)))) {
          if (!tab.dirty) remove(key);
          return;
        }
        if (tab.dirty) {
          if (tab.review && review?.change.version !== tab.review.change.version)
            patch(key, { outdated: true, records });
          else patch(key, { records });
          return;
        }
        if (review) states.set(key, createReviewState(review));
        else states.delete(key);
        patch(key, {
          review,
          records,
          title: review?.candidate.title ?? entryTitle(tab.entryId),
          status: 'ready',
          error: '',
          outdated: false,
          generation: tab.generation + 1
        });
      } catch (cause) {
        if (find(key)) patch(key, { status: 'error', error: toErrorMessage(cause) });
      }
    })().finally(() => loads.delete(key));
    loads.set(key, next);
    return next;
  }

  function open(target: { sessionId: string; entryId: string }) {
    const key = tabKey(target.sessionId, target.entryId);
    if (!find(key)) {
      const pending = creation.pendingEntries.find(change => change.targetId === target.entryId);
      const section =
        creation.entries.find(entry => entry.id === target.entryId)?.section ??
        pending?.candidate.section ??
        'resource';
      tabs.value = [
        ...tabs.value,
        {
          key,
          sessionId: target.sessionId,
          workId: creation.workId!,
          entryId: target.entryId,
          title: entryTitle(target.entryId),
          section,
          review: null,
          records: [],
          status: 'loading',
          error: '',
          dirty: false,
          busy: false,
          outdated: false,
          generation: 0
        }
      ];
    }
    return load(key);
  }
  /** 会话卡片里的「查看」：打开并切到前台。 */
  async function reveal(target: { sessionId: string; entryId: string }) {
    activeId.value = tabKey(target.sessionId, target.entryId);
    await open(target);
  }
  function select(key: string) {
    if (find(key)) activeId.value = key;
  }
  function remove(key: string) {
    states.delete(key);
    tabs.value = tabs.value.filter(tab => tab.key !== key);
    if (activeId.value === key) activeId.value = '';
  }
  function close(key: string): boolean {
    const tab = find(key);
    if (!tab) return true;
    if (tab.dirty) {
      patch(key, { error: '有未保存的手改，请先保存或撤销后再关闭' });
      return false;
    }
    remove(key);
    return true;
  }

  /** 本会话还有待处理修改的下一份资料，供处理完的资料标签提示。 */
  function nextResource(tab: ReviewTab): { entryId: string; title: string } | null {
    for (const change of creation.pendingChanges) {
      if (change.sessionId !== tab.sessionId) continue;
      const ids =
        change.target === 'record'
          ? recordResources(change)
          : change.candidate.section === 'resource'
            ? [change.targetId]
            : [];
      const entryId = ids.find(id => id !== tab.entryId);
      if (entryId) return { entryId, title: entryTitle(entryId) };
    }
    return null;
  }
  /** 处理完的资料标签换成下一份资料。 */
  async function openNext(key: string) {
    const tab = find(key);
    const next = tab && nextResource(tab);
    if (!next) return;
    remove(key);
    await reveal({ sessionId: tab.sessionId, entryId: next.entryId });
  }

  function getState(key: string) {
    return states.get(key);
  }
  function updateState(key: string, state: EditorState) {
    states.set(key, state);
    const tab = find(key);
    if (!tab?.review) return;
    const dirty = state.doc.toString() !== (tab.review.candidate.content ?? '').replaceAll(/\r\n?/g, '\n');
    if (dirty !== tab.dirty) patch(key, { dirty, error: '' });
  }

  async function act(key: string, operation: (tab: ReviewTab) => Promise<unknown>) {
    const tab = find(key);
    if (!tab || tab.busy) return false;
    patch(key, { busy: true, error: '' });
    let error = '';
    try {
      await operation(tab);
    } catch (cause) {
      error = toErrorMessage(cause);
    }
    // 重新读取会清除读取错误，操作失败的提示在读取之后写入。
    if (find(key)) patch(key, { busy: false });
    if (find(key)) await load(key);
    if (find(key) && error) patch(key, { error });
    if (viewingSessionId.value) await refreshDeliveries(viewingSessionId.value);
    return !error;
  }

  /** 缺省时整篇接受或拒绝；range 决定正文的一处，title 只决定改名。 */
  function decide(key: string, decision: 'accept' | 'reject', scope?: ReviewRange | 'title') {
    return act(key, tab =>
      requestCreation('decideReview', {
        commandId: command(),
        ...reviewTarget(tab.review!),
        decision,
        ...(scope === 'title' ? { part: 'title' as const } : scope ? { range: scope } : {})
      })
    );
  }
  /** 保存作者手改；resolveConflicts 表示作者已检查冲突。 */
  function save(key: string, resolveConflicts = false) {
    const tab = find(key);
    if (!tab?.review || (!tab.dirty && !resolveConflicts) || tab.outdated) return Promise.resolve(false);
    const state = states.get(key)!;
    const content =
      tab.review.candidate.content === null ? null : serializeLike(state.doc, tab.review.candidate.content);
    return act(key, async ({ review }) => {
      await requestCreation('updateReview', {
        commandId: command(),
        ...reviewTarget(review!),
        title: review!.candidate.title,
        content,
        resolveConflicts
      });
      if (find(key)) patch(key, { dirty: false });
    });
  }
  /** 放弃手改并读取最新候选。 */
  function discardEdits(key: string) {
    patch(key, { dirty: false, outdated: false, error: '' });
    return load(key);
  }

  /** 事件候选以作者看到的候选版本与正式修订校验；事件没有目录位置。 */
  function recordTarget(change: RecordChange): ReviewTarget {
    return {
      changeId: change.id,
      expectedVersion: change.version,
      expectedRevisionId: creation.records.find(record => record.id === change.targetId)?.revisionId ?? null,
      expectedLocation: null
    };
  }
  function decideRecord(key: string, change: RecordChange, decision: 'accept' | 'reject') {
    return act(key, () => requestCreation('decideReview', { commandId: command(), ...recordTarget(change), decision }));
  }
  /** 作者手改事件候选；有冲突时保存即表示已检查。 */
  function updateRecord(key: string, change: RecordChange, fields: RecordFields) {
    return act(key, () =>
      requestCreation('updateRecordReview', {
        commandId: command(),
        ...recordTarget(change),
        // 按传输契约逐项取字段，调用方传入的快照可能带有其他属性。
        resourceIds: [...fields.resourceIds],
        text: fields.text,
        source: { ...fields.source },
        placement: { ...fields.placement },
        storyTime: fields.storyTime,
        resolveConflicts: change.conflicts.length > 0
      })
    );
  }
  /** 新资料候选的事件改为关联已有资料，新资料随之拒绝。 */
  function relink(key: string, resourceId: string) {
    return act(key, tab =>
      requestCreation('relinkResource', {
        commandId: command(),
        changeId: tab.review!.change.id,
        expectedVersion: tab.review!.change.version,
        resourceId
      })
    );
  }

  /** 目录树对新建候选的整体决定；失败交给调用方显示。 */
  async function decideChange(changeId: string, decision: 'accept' | 'reject') {
    const current = entryReview(await requestCreation('readReview', { changeId }));
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
    for (const tab of tabs.value) if (tab.sessionId === sessionId) void load(tab.key);
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
      const ids = pending.target === 'entry' ? [pending.targetId] : recordResources(pending);
      const affected = tabs.value.filter(tab => tab.sessionId === pending.sessionId && ids.includes(tab.entryId));
      for (const tab of affected) void load(tab.key);
      if (affected.length || own || pending.status !== 'pending' || pending.workId !== creation.workId) return;
      const resource = pending.target === 'record' || pending.candidate.section === 'resource';
      if (resource && tabs.value.some(tab => tab.sessionId === pending.sessionId && tab.section === 'resource')) return;
      const target = { sessionId: pending.sessionId, entryId: changeEntryId(pending) };
      void open(target);
      if (viewingSessionId.value === pending.sessionId && !editorFocused())
        activeId.value = tabKey(target.sessionId, target.entryId);
      return;
    }
    if (change.kind === 'delivery') {
      if (viewingSessionId.value === change.group.sessionId) void refreshDeliveries(change.group.sessionId);
      return;
    }
    if (change.kind === 'work' || change.kind === 'library' || event.cursor.workId !== creation.workId) return;
    // 正式稿与事件变化会改变冲突与可接受状态。
    for (const tab of tabs.value) void load(tab.key);
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
    activeId.value = dirty.key;
    patch(dirty.key, { error: '有未保存的手改，请先保存或撤销' });
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
    nextResource,
    openNext,
    getState,
    updateState,
    decide,
    save,
    discardEdits,
    decideRecord,
    updateRecord,
    relink,
    decideChange,
    refreshDeliveries,
    decideGroup,
    endTask,
    confirmLeave,
    hasUnsaved: computed(() => tabs.value.some(tab => tab.dirty))
  };
});
