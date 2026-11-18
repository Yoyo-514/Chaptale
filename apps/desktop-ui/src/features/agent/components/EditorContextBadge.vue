<script setup lang="ts">
import { computed } from 'vue';

import type { EditorContext } from '@chaptale/agent-host/protocol';

const props = defineProps<{ context: EditorContext }>();
const label = computed(() => `${props.context.section === 'resource' ? '资料' : '文稿'}《${props.context.title}》选区`);
</script>

<template>
  <details v-if="context.selection" class="agent-editor-context" aria-label="编辑上下文">
    <summary :title="label">
      <span class="i-mingcute-quote-left-line size-3.5 shrink-0" aria-hidden="true" />
      <span class="agent-editor-context-title">{{ label }}</span>
      <span class="i-mingcute-down-line agent-editor-context-chevron size-3.5 shrink-0" aria-hidden="true" />
    </summary>
    <div class="agent-editor-context-detail">
      <pre>{{ context.selection }}</pre>
    </div>
  </details>
</template>

<style lang="scss">
.agent-editor-context {
  min-width: 0;
  max-width: 100%;
  margin: 0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.agent-editor-context > summary {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 22px;
  min-width: 0;
  gap: 4px;
  list-style: none;
  cursor: pointer;
  border-radius: var(--radius-control-sm);
}
.agent-editor-context > summary::-webkit-details-marker {
  display: none;
}
.agent-editor-context > summary:hover {
  color: var(--foreground);
}
.agent-editor-context-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-editor-context-chevron {
  transition: transform 150ms ease-out;
}
.agent-editor-context[open] .agent-editor-context-chevron {
  transform: rotate(180deg);
}
.agent-editor-context-detail {
  padding: 4px 0 4px 12px;
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.agent-editor-context-detail p {
  margin: 2px 0;
}
.agent-editor-context-detail pre {
  max-height: 14rem;
  overflow: auto;
  padding: 6px 8px;
  border-left: 1px solid var(--border);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  margin: 4px 0 0;
}
</style>
