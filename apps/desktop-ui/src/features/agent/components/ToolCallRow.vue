<script setup lang="ts">
import { computed, getCurrentInstance, ref } from 'vue';

import { useCreationStore } from '@/features/creation';
import { useEditorStore, useReviewStore } from '@/features/editor';

import { parseToolDetail, type EntryLookup, type ResolvedEntryInfo } from '../tool-detail';
import type { ToolActivity, ToolEntryTarget } from '../transcript';

const props = defineProps<{
  tool: ToolActivity;
  running: boolean;
  sessionId?: string | null;
  sessionWorkId?: string | null;
}>();

const expanded = ref(false);
const rawExpanded = ref(false);

// 单测独立挂载 MessageList 且未安装 Pinia 时保持降级，不中断纯视图渲染。
const hasPinia = Boolean(getCurrentInstance()?.appContext.config.globalProperties.$pinia);
const creation = hasPinia ? useCreationStore() : null;
const editor = hasPinia ? useEditorStore() : null;
const review = hasPinia ? useReviewStore() : null;

function resolveOpenable(
  target: ToolEntryTarget | undefined
): { kind: 'review' | 'document'; entryId: string; title: string } | null {
  if (!creation?.workId || !editor || !review || !target) return null;
  const effectiveWorkId = target.workId ?? props.sessionWorkId ?? null;
  if (effectiveWorkId && effectiveWorkId !== creation.workId) return null;
  const hasPendingDoc =
    Boolean(props.sessionId) &&
    (review.summaries[props.sessionId!] ?? []).some(
      item => 'targetId' in item && item.targetId === target.entryId && item.kind === 'document' && !item.deleted
    );
  if (hasPendingDoc) return { kind: 'review', entryId: target.entryId, title: target.title };
  const doc = creation.entries.find(item => item.id === target.entryId && item.kind === 'document');
  if (doc) return { kind: 'document', entryId: doc.id, title: target.title };
  return null;
}

const openableTarget = computed(() => resolveOpenable(props.tool.entryTarget));

const summaryParts = computed(() => {
  const target = openableTarget.value;
  if (!target) return null;
  const token = `《${target.title}》`;
  const index = props.tool.summary.indexOf(token);
  if (index === -1) return null;
  return {
    prefix: props.tool.summary.slice(0, index),
    suffix: props.tool.summary.slice(index + token.length)
  };
});

const entryLookup = computed<EntryLookup | undefined>(() => {
  if (!creation) return undefined;
  return (entryId: string): ResolvedEntryInfo | undefined => {
    const entry = creation.entries.find(item => item.id === entryId);
    if (entry) {
      return {
        ...(creation.workId && { workId: creation.workId }),
        entryId: entry.id,
        title: entry.title,
        kind: entry.kind
      };
    }
    const pending = creation.pendingEntries.find(change => change.targetId === entryId && !change.deleted);
    if (pending) {
      return {
        ...(creation.workId && { workId: creation.workId }),
        entryId: pending.targetId,
        title: pending.candidate.title,
        kind: pending.candidate.kind
      };
    }
    return undefined;
  };
});

const detail = computed(() => parseToolDetail(props.tool, entryLookup.value));

function openEntry(target: ToolEntryTarget | undefined) {
  const resolved = resolveOpenable(target);
  if (!resolved || !editor || !review) return;
  if (resolved.kind === 'review' && props.sessionId) {
    void review.reveal({ sessionId: props.sessionId, entryId: resolved.entryId });
    return;
  }
  void editor.openDocument(resolved.entryId);
}
</script>

<template>
  <div class="agent-tool-call" :class="{ 'agent-tool-failure': tool.result?.error, 'is-nested': tool.nested }">
    <div v-if="openableTarget && summaryParts" class="agent-activity-line" :title="tool.summary">
      <button type="button" class="agent-activity-row is-split" :aria-expanded="expanded" @click="expanded = !expanded">
        <span
          v-if="!tool.result && running && !tool.incomplete"
          class="i-mingcute-loading-line agent-activity-icon animate-spin"
          aria-label="进行中"
        />
        <span
          v-else-if="tool.result?.error"
          class="i-mingcute-warning-line agent-activity-icon is-error"
          aria-label="失败"
        />
        <span
          v-else-if="!tool.result || tool.incomplete"
          class="i-mingcute-stop-fill agent-activity-icon"
          aria-label="已停止"
        />
        <span v-else class="i-mingcute-file-search-line agent-activity-icon" aria-hidden="true" />
        <span class="agent-activity-prefix">{{ summaryParts.prefix }}</span>
      </button>
      <button
        type="button"
        class="agent-activity-target"
        :aria-label="`打开《${openableTarget.title}》`"
        @click="openEntry(tool.entryTarget)"
      >
        《{{ openableTarget.title }}》
      </button>
      <button type="button" class="agent-activity-tail" tabindex="-1" aria-hidden="true" @click="expanded = !expanded">
        <span v-if="summaryParts.suffix" class="agent-activity-suffix">{{ summaryParts.suffix }}</span>
        <span class="i-mingcute-right-line agent-activity-chevron" />
      </button>
    </div>
    <button v-else type="button" class="agent-activity-row" :aria-expanded="expanded" @click="expanded = !expanded">
      <span
        v-if="!tool.result && running && !tool.incomplete"
        class="i-mingcute-loading-line agent-activity-icon animate-spin"
        aria-label="进行中"
      />
      <span
        v-else-if="tool.result?.error"
        class="i-mingcute-warning-line agent-activity-icon is-error"
        aria-label="失败"
      />
      <span
        v-else-if="!tool.result || tool.incomplete"
        class="i-mingcute-stop-fill agent-activity-icon"
        aria-label="已停止"
      />
      <span v-else class="i-mingcute-file-search-line agent-activity-icon" aria-hidden="true" />
      <span class="agent-activity-summary" :title="tool.summary">{{ tool.summary }}</span>
      <span class="i-mingcute-right-line agent-activity-chevron" aria-hidden="true" />
    </button>

    <div v-if="expanded" class="agent-activity-detail" aria-label="步骤详情">
      <p v-if="detail.meta.length" class="agent-tool-meta">{{ detail.meta.join(' · ') }}</p>
      <p v-if="detail.error" class="agent-tool-error">{{ detail.error }}</p>

      <ul v-if="detail.items?.length" class="agent-tool-items">
        <li v-for="item in detail.items" :key="item.key" class="agent-tool-item">
          <div class="agent-tool-item-head">
            <template v-if="item.target">
              <button
                v-if="resolveOpenable(item.target)"
                type="button"
                class="agent-activity-target"
                :aria-label="`打开《${item.target.title}》`"
                @click="openEntry(item.target)"
              >
                《{{ item.target.title }}》
              </button>
              <span v-else class="agent-tool-item-label">《{{ item.target.title }}》</span>
            </template>
            <span v-if="item.connector" class="agent-tool-item-connector">{{ item.connector }}</span>
            <template v-if="item.secondaryTarget">
              <button
                v-if="resolveOpenable(item.secondaryTarget)"
                type="button"
                class="agent-activity-target"
                :aria-label="`打开《${item.secondaryTarget.title}》`"
                @click="openEntry(item.secondaryTarget)"
              >
                《{{ item.secondaryTarget.title }}》
              </button>
              <span v-else class="agent-tool-item-label">《{{ item.secondaryTarget.title }}》</span>
            </template>
            <span v-if="item.label" class="agent-tool-item-label">{{ item.label }}</span>
            <span v-if="item.meta" class="agent-tool-item-meta">{{ item.meta }}</span>
          </div>
          <p v-if="item.snippet" class="agent-tool-item-snippet">{{ item.snippet }}</p>
        </li>
      </ul>

      <p v-if="detail.emptyText" class="agent-activity-empty">{{ detail.emptyText }}</p>

      <div v-if="detail.edits?.length" class="agent-tool-edits">
        <div v-for="(edit, idx) in detail.edits" :key="idx" class="agent-tool-edit">
          <p v-if="edit.oldText" class="agent-tool-edit-old">{{ edit.oldText }}</p>
          <p v-if="edit.newText" class="agent-tool-edit-new">{{ edit.newText }}</p>
        </div>
      </div>

      <pre v-if="detail.body" class="agent-tool-body">{{ detail.body }}</pre>
      <p v-if="detail.basis" class="agent-tool-basis">依据：{{ detail.basis }}</p>

      <p v-if="!tool.result" class="agent-activity-empty">{{ running ? '正在等待结果…' : '调用已停止。' }}</p>

      <div v-if="detail.hasRaw" class="agent-tool-raw">
        <button
          type="button"
          class="agent-tool-raw-toggle"
          :aria-expanded="rawExpanded"
          @click="rawExpanded = !rawExpanded"
        >
          <span class="i-mingcute-right-line agent-tool-raw-chevron" aria-hidden="true" />
          <span>原始参数与返回（{{ tool.name }}）</span>
        </button>
        <div v-if="rawExpanded" class="agent-tool-raw-body" aria-label="原始参数与结果">
          <pre v-if="detail.rawInput">{{ detail.rawInput }}</pre>
          <pre v-if="detail.rawOutput" :class="{ 'agent-error': tool.result?.error }">{{ detail.rawOutput }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>
