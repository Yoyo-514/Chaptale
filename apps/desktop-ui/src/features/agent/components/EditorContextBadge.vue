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
