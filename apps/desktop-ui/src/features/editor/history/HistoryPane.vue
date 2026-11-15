<script setup lang="ts">
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { unifiedMergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { drawSelection, EditorView, lineNumbers } from '@codemirror/view';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppListItem } from '@/components/AppListItem';
import { AppNotice } from '@/components/AppNotice';
import { AppScrollArea } from '@/components/AppScrollArea';

import { DIFF_SCAN_LIMIT, diffTheme, theme, writingHighlight } from '../codemirror/theme';
import { type HistoryTab, useHistoryStore } from './store';

const props = defineProps<{ tab: HistoryTab }>();
const history = useHistoryStore();
const time = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' });
const sources = { author: '作者保存', agent: 'Agent 修改', review: '接受修改' } as const;
const selected = computed(() => props.tab.revisions.find(item => item.id === props.tab.selectedId) ?? null);
const unchanged = computed(() => props.tab.selectedContent === props.tab.current!.content);

// 只读同区对比：以当前正式内容为原文，正文为选中版本；标绿为恢复后加入的内容，删除线为恢复后移除的内容。
const host = ref<HTMLElement | null>(null);
let view: EditorView | undefined;
function render() {
  view?.destroy();
  view = undefined;
  if (!host.value || props.tab.selectedContent === null) return;
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.tab.selectedContent,
      extensions: [
        unifiedMergeView({
          original: props.tab.current!.content,
          mergeControls: false,
          gutter: true,
          collapseUnchanged: { margin: 3, minSize: 8 },
          diffConfig: { scanLimit: DIFF_SCAN_LIMIT }
        }),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({ 'aria-label': `${props.tab.title} 的版本对比` }),
        drawSelection(),
        lineNumbers(),
        EditorView.lineWrapping,
        EditorState.phrases.of({ '$ unchanged lines': '$ 行未改动' }),
        theme,
        diffTheme,
        props.tab.current!.format === 'markdown' ? [markdown(), syntaxHighlighting(writingHighlight)] : []
      ]
    })
  });
}
onMounted(render);
// 从“与当前版本相同”切换过来时挂载点才出现，渲染需等 DOM 更新后进行。
watch(() => [props.tab.selectedContent, props.tab.current], render, { flush: 'post' });
onBeforeUnmount(() => view?.destroy());
</script>

<template>
  <div class="history-pane">
    <AppScrollArea class="history-list">
      <div class="history-items" aria-label="历史版本">
        <AppListItem
          v-for="(revision, index) in tab.revisions"
          :key="revision.id"
          :title="time.format(revision.createdAt)"
          :description="`${index ? sources[revision.source] : '当前版本'} · ${revision.wordCount} 字`"
          :selected="revision.id === tab.selectedId"
          @click="history.selectRevision(tab.documentId, revision.id)"
        />
      </div>
    </AppScrollArea>
    <section class="history-compare" aria-label="版本对比">
      <header class="history-bar">
        <span class="history-caption">{{
          selected ? `当前版本 → ${time.format(selected.createdAt)} 的版本` : '选择一个版本'
        }}</span>
        <span class="history-legend"
          ><span class="legend-added">标绿</span>恢复后加入　<span class="legend-removed">删除线</span>恢复后移除</span
        >
        <AppButton
          size="xs"
          variant="primary"
          :disabled="tab.selectedContent === null || unchanged || tab.restoring"
          @click="history.restore(tab.documentId)"
          >恢复此版本</AppButton
        >
      </header>
      <AppNotice v-if="tab.error" tone="error">{{ tab.error }}</AppNotice>
      <p v-if="tab.selectedContent !== null && unchanged" class="history-same" role="status">与当前版本相同</p>
      <div v-else ref="host" class="history-diff" />
    </section>
  </div>
</template>

<style scoped>
.history-pane {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.history-list {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-subtle);
}
.history-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
}
.history-compare {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
}
.history-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 13px;
}
.history-caption {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-legend {
  flex-shrink: 0;
  font-size: var(--ui-caption-size);
  color: var(--muted-foreground);
}
.legend-added {
  margin-right: 2px;
  padding: 0 2px;
  background: color-mix(in srgb, var(--success) 22%, transparent);
  color: var(--foreground);
}
.legend-removed {
  margin-right: 2px;
  padding: 0 2px;
  text-decoration: line-through;
  background: color-mix(in srgb, var(--destructive) 18%, transparent);
  color: var(--foreground);
}
.history-diff {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.history-same {
  padding: 16px;
  color: var(--muted-foreground);
}
</style>
