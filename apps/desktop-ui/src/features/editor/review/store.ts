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
  RelationChange,
  RelationInput,
  RecordFields,
  ReviewRange,
  ReviewTarget,
  ReviewView
} from '@chaptale/creation/contracts';

import { requestCreation, storyResources, useCreationStore } from '@/features/creation';
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
  /** 条目自身的待接受修改；只有事件或关系候选时为 null。 */
  review: EntryReviewView | null;
  records: RecordChange[];
  relations: RelationChange[];
  /** 须先处理本章正文的候选 ID 到待审正文所在章节。 */
  waiting: ReadonlyMap<string, string[]>;
  status: 'loading' | 'ready' | 'error';
  error: string;
  dirty: boolean;
  busy: boolean;
  /** 作者有未保存手改时候选又被更新；保存会因版本不符失败，需重新读取。 */
  outdated: boolean;
  /** 服务端候选更新后递增，审阅面板据此重建编辑器。 */
  generation: number;
}

/** 资料标签上的修改都已处理，只剩正式资料与下一份提示。 */
export function reviewDone(tab: ReviewTab): boolean {
  return tab.status === 'ready' && !tab.review && !tab.records.length && !tab.relations.length;
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

/**
 * 须先处理本章正文的事件与关系候选及其章节：出处修订不是该章待审前的正式修订，即指向同一会话的待审正文。
 * changes 为同一会话的待审修改。
 */
export function draftSources(changes: readonly PendingChange[]): Map<string, string[]> {
  const drafts = new Map(
    changes
      .filter((change): change is EntryChange => change.target === 'entry')
      .map(change => [change.targetId, change.base?.revisionId ?? null])
  );
  const waiting = new Map<string, string[]>();
  for (const change of changes) {
    if (change.target === 'entry') continue;
    const sources =
      change.target === 'record' ? [change.candidate.source] : change.candidate.milestones.map(item => item.source);
    const chapters = [
      ...new Set(
        sources
          .filter(
            source =>
              source.kind === 'chapter' &&
              drafts.has(source.chapterId) &&
              drafts.get(source.chapterId) !== source.revisionId
          )
          .map(source => (source as { chapterId: string }).chapterId)
      )
    ];
    if (chapters.length) waiting.set(change.id, chapters);
  }
  return waiting;
}

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
          (change): change is RecordChange => change.target === 'record' && storyResources(change).includes(tab.entryId)
        );
        const relations = changes.filter(
          (change): change is RelationChange =>
            change.target === 'relation' && storyResources(change).includes(tab.entryId)
        );
        const waiting = draftSources(changes);
        const review = own ? entryReview(await requestCreation('readReview', { changeId: own.id })) : null;
        if (!find(key)) return;
        // 文稿处理完即关闭；资料留在标签上提示下一份，资料的新建或修改被拒绝、删除被接受后关闭。
        if (!review && !records.length && !relations.length && (tab.section === 'manuscript' || !(await kept(tab)))) {
          if (!tab.dirty) remove(key);
          return;
        }
        if (tab.dirty) {
          if (tab.review && review?.change.version !== tab.review.change.version)
            patch(key, { outdated: true, records, relations, waiting });
          else patch(key, { records, relations, waiting });
          return;
        }
        if (review) states.set(key, createReviewState(review));
        else states.delete(key);
        patch(key, {
          review,
          records,
          relations,
          waiting,
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
          relations: [],
          waiting: new Map(),
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
  /** 关闭当前标签时切到相邻的审阅标签，没有则交还文稿标签。 */
  function remove(key: string) {
    states.delete(key);
    const index = tabs.value.findIndex(tab => tab.key === key);
    tabs.value = tabs.value.filter(tab => tab.key !== key);
    if (activeId.value === key) activeId.value = (tabs.value[index] ?? tabs.value[index - 1])?.key ?? '';
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

  /** 整篇拒绝该正文修改时随之拒绝的事件与关系候选数。 */
  function draftDependents(change: EntryChange): number {
    const session = creation.pendingChanges.filter(item => item.sessionId === change.sessionId);
    return [...draftSources(session).values()].filter(chapters => chapters.includes(change.targetId)).length;
  }
  /** 整篇拒绝条目修改时一并拒绝的事件与关系候选数：出处是这份新正文，或依赖这份新资料。 */
  function rejectDependents(change: EntryChange): number {
    if (change.deleted) return 0;
    if (change.candidate.section === 'manuscript') return draftDependents(change);
    if (change.base) return 0;
    return (creation.pendingStories.get(change.targetId) ?? []).filter(item => item.sessionId === change.sessionId)
      .length;
  }

  /** 本会话还有待处理修改的下一份资料，供处理完的资料标签提示。 */
  function nextResource(tab: ReviewTab): { entryId: string; title: string } | null {
    for (const change of creation.pendingChanges) {
      if (change.sessionId !== tab.sessionId) continue;
      const ids =
        change.target !== 'entry'
          ? storyResources(change)
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

  /** 事件与关系候选以作者看到的候选版本与正式修订校验；二者没有目录位置。 */
  function storyTarget(change: RecordChange | RelationChange): ReviewTarget {
    const formal = change.target === 'record' ? creation.records : creation.relations;
    return {
      changeId: change.id,
      expectedVersion: change.version,
      expectedRevisionId: formal.find(item => item.id === change.targetId)?.revisionId ?? null,
      expectedLocation: null
    };
  }
  function decideStory(key: string, change: RecordChange | RelationChange, decision: 'accept' | 'reject') {
    return act(key, () => requestCreation('decideReview', { commandId: command(), ...storyTarget(change), decision }));
  }
  /** 作者手改事件候选；有冲突时保存即表示已检查。 */
  function updateRecord(key: string, change: RecordChange, fields: RecordFields) {
    return act(key, () =>
      requestCreation('updateRecordReview', {
        commandId: command(),
        ...storyTarget(change),
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
  /** 作者手改关系候选；有冲突时保存即表示已检查。 */
  function updateRelation(key: string, change: RelationChange, input: RelationInput) {
    return act(key, () =>
      requestCreation('updateRelationReview', {
        commandId: command(),
        ...storyTarget(change),
        resourceIds: [...input.resourceIds],
        type: input.type,
        directed: input.directed,
        titles: [...input.titles],
        milestones: input.milestones.map(milestone => ({
          id: milestone.id,
          kind: milestone.kind,
          source: { ...milestone.source },
          placement: { ...milestone.placement },
          storyTime: milestone.storyTime
        })),
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
      const ids = pending.target === 'entry' ? [pending.targetId] : storyResources(pending);
      const affected = tabs.value.filter(tab => tab.sessionId === pending.sessionId && ids.includes(tab.entryId));
      for (const tab of affected) void load(tab.key);
      if (affected.length || own || pending.status !== 'pending' || pending.workId !== creation.workId) return;
      const resource = pending.target !== 'entry' || pending.candidate.section === 'resource';
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
    draftDependents,
    rejectDependents,
    nextResource,
    openNext,
    getState,
    updateState,
    decide,
    save,
    discardEdits,
    decideStory,
    updateRecord,
    updateRelation,
    relink,
    decideChange,
    refreshDeliveries,
    decideGroup,
    endTask,
    confirmLeave,
    hasUnsaved: computed(() => tabs.value.some(tab => tab.dirty))
  };
});
