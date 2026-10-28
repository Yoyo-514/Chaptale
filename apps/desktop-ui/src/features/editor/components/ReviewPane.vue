<script lang="ts">
/** 候选更新会重建编辑器，按修改记住滚动位置。 */
const scrollTops = new Map<string, number>();
</script>

<script setup lang="ts">
import { getChunks, getOriginalDoc } from '@codemirror/merge';
import { EditorView } from '@codemirror/view';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppTextView } from '@/components/AppTextView';
import { useCreationStore } from '@/features/creation';

import { chunkRange } from '../review/chunk-range';
import { type ReviewTab, useReviewStore } from '../review/store';

const props = defineProps<{ tab: ReviewTab }>();
const review = useReviewStore();
const creation = useCreationStore();
const host = ref<HTMLElement>();
const blockError = ref('');
let view: EditorView | undefined;
let frame: number | undefined;

const data = computed(() => props.tab.review!);
const current = computed(() => data.value.current);
const candidate = computed(() => data.value.candidate);
/** 删除只能整篇决定，正文只读展示。 */
const deleted = computed(() => data.value.change.deleted === true);
const conflicted = computed(() => data.value.conflicts.length > 0);
const titleConflicted = computed(() => data.value.conflicts.some(item => item.field === 'title'));
const renamed = computed(() => current.value !== null && current.value.title !== candidate.value.title);
const moved = computed(
  () =>
    current.value !== null &&
    (current.value.parentId !== candidate.value.parentId || current.value.position !== candidate.value.position)
);
const destination = computed(() => {
  const parentId = candidate.value.parentId;
  if (parentId === null) return '顶层';
  return `「${creation.entries.find(entry => entry.id === parentId)?.title ?? '新建目录'}」下`;
});
const fields: Record<string, string> = {
  content: '正文',
  title: '标题',
  format: '格式',
  parentId: '位置',
  position: '位置'
};
const conflictFields = computed(() => [...new Set(data.value.conflicts.map(item => fields[item.field]))].join('、'));
const locked = computed(() => props.tab.busy || props.tab.dirty);

function blockAction(event: MouseEvent) {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-review-action]');
  if (!button || !view) return;
  event.preventDefault();
  blockError.value = '';
  if (locked.value) {
    blockError.value = props.tab.dirty ? '有未保存的手改，请先保存或撤销，再逐处决定' : '';
    return;
  }
  const decision = button.dataset.reviewAction as 'accept' | 'reject';
  if (decision === 'accept' && conflicted.value) {
    blockError.value = '请先处理冲突，再接受修改';
    return;
  }
  const fromB = Number(button.closest<HTMLElement>('[data-chunk-from]')!.dataset.chunkFrom);
  const chunk = getChunks(view.state)?.chunks.find(item => item.fromB === fromB);
  if (!chunk) return;
  const range = chunkRange(
    chunk,
    getOriginalDoc(view.state),
    view.state.doc,
    current.value?.content ?? '',
    candidate.value.content ?? ''
  );
  if (!range) {
    blockError.value = '这一处位于文稿开头且涉及末行换行，请用「全部接受」或「全部拒绝」处理';
    return;
  }
  void review.decide(props.tab.changeId, decision, range);
}

onMounted(() => {
  if (!host.value) return;
  view = new EditorView({
    parent: host.value!,
    state: review.getState(props.tab.changeId)!,
    dispatchTransactions(transactions, currentView) {
      currentView.update(transactions);
      if (transactions.some(transaction => transaction.docChanged))
        review.updateState(props.tab.changeId, currentView.state);
    }
  });
  const top = scrollTops.get(props.tab.changeId);
  if (top !== undefined)
    frame = requestAnimationFrame(() => {
      view!.scrollDOM.scrollTop = top;
    });
});
onBeforeUnmount(() => {
  if (frame !== undefined) cancelAnimationFrame(frame);
  if (!view) return;
  scrollTops.set(props.tab.changeId, view.scrollDOM.scrollTop);
  review.updateState(props.tab.changeId, view.state);
  view.destroy();
});
</script>

<template>
  <section class="review-pane" :class="{ locked }" :aria-label="`审阅《${candidate.title}》`" :aria-busy="tab.busy">
    <header class="review-toolbar">
      <div class="review-heading">
        <span class="review-badge">待接受</span>
        <span class="review-title">{{ candidate.title }}</span>
        <span v-if="deleted" class="review-meta review-deleted"
          >删除{{ candidate.kind === 'directory' ? '目录及其中内容' : '' }}，接受后移入作品回收站</span
        >
        <span v-else-if="!current" class="review-meta">新建{{ candidate.kind === 'directory' ? '目录' : '' }}</span>
      </div>
      <AppButton size="sm" variant="ghost" :disabled="locked" @click="review.decide(tab.changeId, 'reject')">{{
        deleted ? '拒绝删除' : '全部拒绝'
      }}</AppButton>
      <AppButton
        size="sm"
        variant="primary"
        :disabled="locked || conflicted"
        :title="conflicted ? '请先处理冲突' : undefined"
        @click="review.decide(tab.changeId, 'accept')"
        >{{ deleted ? '接受删除' : '全部接受' }}</AppButton
      >
    </header>
    <div v-if="renamed && !deleted" class="review-row">
      <span
        >标题：<del>{{ current!.title }}</del> → {{ candidate.title }}</span
      >
      <AppButton size="xs" variant="ghost" :disabled="locked" @click="review.decide(tab.changeId, 'reject', 'title')"
        >保留原标题</AppButton
      >
      <AppButton
        size="xs"
        variant="ghost"
        :disabled="locked || titleConflicted"
        :title="titleConflicted ? '标题有冲突，请先处理冲突' : undefined"
        @click="review.decide(tab.changeId, 'accept', 'title')"
        >接受改名</AppButton
      >
    </div>
    <div v-if="moved && !deleted" class="review-row">
      <span>位置：移到{{ destination }}，随整篇一起接受或拒绝</span>
    </div>
    <div v-if="conflicted" class="review-row review-conflict" role="status">
      <span>Agent 修改期间，正式稿的{{ conflictFields }}也有变化。可直接在下方修改候选，确认后标记已解决。</span>
      <AppButton size="xs" variant="ghost" :disabled="tab.busy || tab.outdated" @click="review.save(tab.changeId, true)"
        >已检查，标记解决</AppButton
      >
    </div>
    <div v-if="tab.outdated" class="review-row review-conflict" role="alert">
      <span>Agent 已更新这份候选，当前手改无法保存。</span>
      <AppButton size="xs" variant="ghost" @click="review.discardEdits(tab.changeId)">放弃手改并重新读取</AppButton>
    </div>
    <div v-else-if="tab.dirty" class="review-row" role="status">
      <span>有未保存的手改，Ctrl+S 保存；保存前不能逐处或整篇决定。</span>
      <AppButton size="xs" variant="ghost" :disabled="tab.busy" @click="review.discardEdits(tab.changeId)"
        >撤销手改</AppButton
      >
      <AppButton size="xs" variant="primary" :disabled="tab.busy" @click="review.save(tab.changeId)">保存</AppButton>
    </div>
    <p v-if="tab.error || blockError" class="review-error" role="alert">{{ tab.error || blockError }}</p>
    <AppTextView
      v-if="deleted && candidate.content !== null"
      class="review-editor review-deleted-text"
      :text="candidate.content"
      :label="`将删除的《${candidate.title}》，只读`"
    />
    <p v-else-if="deleted" class="review-row">目录中的内容会一起移入作品回收站。</p>
    <div v-else ref="host" class="review-editor" @mousedown="blockAction" />
  </section>
</template>

<style scoped>
.review-deleted {
  color: var(--destructive);
}
.review-deleted-text {
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--destructive) 60%, transparent);
}
.review-pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.review-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 4px 12px 4px 16px;
  border-bottom: 1px solid var(--border-subtle);
}
.review-heading {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.review-badge {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--radius-control-sm);
  background: color-mix(in srgb, var(--warning) 16%, transparent);
  color: var(--foreground);
  font-size: var(--ui-caption-size);
  line-height: 20px;
}
.review-title {
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.review-meta {
  flex-shrink: 0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.review-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 16px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 13px;
}
.review-row > span {
  flex: 1;
  min-width: 0;
}
.review-conflict {
  background: color-mix(in srgb, var(--warning) 10%, transparent);
}
.review-error {
  margin: 0;
  padding: 6px 16px;
  color: var(--destructive);
  font-size: 13px;
  white-space: pre-line;
}
.review-editor {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.review-editor :deep(.cm-editor) {
  height: 100%;
}
.locked .review-editor :deep(.cm-chunkButtons button) {
  opacity: 0.5;
  cursor: default;
}
</style>
