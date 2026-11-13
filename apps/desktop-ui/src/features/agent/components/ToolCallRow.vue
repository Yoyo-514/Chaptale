<script setup lang="ts">
import { ref } from 'vue';

import type { ToolActivity } from '../transcript';

defineProps<{ tool: ToolActivity; running: boolean }>();
const expanded = ref(false);
const format = (value: unknown) => JSON.stringify(value, null, 2);
</script>

<template>
  <div class="agent-tool-call" :class="{ 'agent-tool-failure': tool.result?.error, 'is-nested': tool.nested }">
    <button type="button" class="agent-activity-row" :aria-expanded="expanded" @click="expanded = !expanded">
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
