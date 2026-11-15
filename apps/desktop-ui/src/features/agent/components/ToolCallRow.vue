<script setup lang="ts">
import { computed, getCurrentInstance, ref } from 'vue';

import { useCreationStore } from '@/features/creation';
import { useEditorStore, useReviewStore } from '@/features/editor';

import type { ToolActivity } from '../transcript';

const props = defineProps<{
  tool: ToolActivity;
  running: boolean;
  sessionId?: string | null;
  sessionWorkId?: string | null;
}>();

const expanded = ref(false);
const format = (value: unknown) => JSON.stringify(value, null, 2);

// 单测独立挂载 MessageList 且未安装 Pinia 时保持降级，不中断纯视图渲染。
const hasPinia = Boolean(getCurrentInstance()?.appContext.config.globalProperties.$pinia);
const creation = hasPinia ? useCreationStore() : null;
const editor = hasPinia ? useEditorStore() : null;
const review = hasPinia ? useReviewStore() : null;

const openableTarget = computed(() => {
  if (!creation?.workId || !editor || !review) return null;
  const target = props.tool.entryTarget;
  if (!target) return null;
  const effectiveWorkId = target.workId ?? props.sessionWorkId ?? null;
  if (effectiveWorkId && effectiveWorkId !== creation.workId) return null;
  const hasPendingDoc =
    Boolean(props.sessionId) &&
    (review.summaries[props.sessionId!] ?? []).some(
      item => 'targetId' in item && item.targetId === target.entryId && item.kind === 'document' && !item.deleted
    );
  if (hasPendingDoc) return { kind: 'review' as const, entryId: target.entryId, title: target.title };
  const doc = creation.entries.find(item => item.id === target.entryId && item.kind === 'document');
  if (doc) return { kind: 'document' as const, entryId: doc.id, title: target.title };
  return null;
});

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

function openTarget() {
  const target = openableTarget.value;
  if (!target || !editor || !review) return;
  if (target.kind === 'review' && props.sessionId) {
    void review.reveal({ sessionId: props.sessionId, entryId: target.entryId });
    return;
  }
  void editor.openDocument(target.entryId);
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
        @click="openTarget"
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
    <div v-if="expanded" class="agent-activity-detail" aria-label="原始参数与结果">
      <p class="agent-activity-empty">工具：{{ tool.name }}</p>
      <pre v-if="tool.input !== undefined">{{ format(tool.input) }}</pre>
      <pre v-if="tool.result?.text" :class="{ 'agent-error': tool.result.error }">{{ tool.result.text }}</pre>
      <p v-else-if="!tool.result" class="agent-activity-empty">{{ running ? '正在等待结果…' : '调用已停止。' }}</p>
    </div>
  </div>
</template>
