<script setup lang="ts">
import { computed } from 'vue';

import type { RunStopRecordReason } from '@chaptale/ipc-contract';

import { STOP_REASON_NOTICES } from '../../utils/message/stop-reason';

const props = defineProps<{
  reason: RunStopRecordReason;
}>();

const notice = computed(() => STOP_REASON_NOTICES[props.reason]);
</script>

<template>
  <div class="message-run-stop" data-slot="message-run-stop">
    <span class="i-mingcute-alert-line message-run-stop-icon size-3.5" aria-hidden="true" />
    <p class="message-run-stop-body">
      <span class="message-run-stop-title">{{ notice.title }}</span>
      <span class="message-run-stop-description">{{ notice.description }}</span>
    </p>
  </div>
</template>

<style scoped lang="scss">
/* 与同位置的消息级 stopNotice 同一套视觉：都是贴着正文的流程说明。
   压缩提示用卡片是因为它可折叠，这里没有交互，不必也不该更重。
   截停也不是错误——回复有效，只是没写完，套 destructive 会误导。 */
.message-run-stop {
  @apply m-0 flex items-start gap-1.5 text-xs;

  color: var(--muted-foreground);
}

.message-run-stop-icon {
  @apply mt-0.5 shrink-0;
}

.message-run-stop-body {
  @apply m-0 flex flex-col gap-0.5 leading-relaxed;
}

.message-run-stop-title {
  color: var(--foreground);
}

.message-run-stop-description {
  overflow-wrap: break-word;
}
</style>
