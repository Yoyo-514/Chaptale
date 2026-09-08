<script setup lang="ts">
import { computed } from 'vue';

import type { RecordedTokenUsage } from '@chaptale/shared';

import { tokenUsageRows } from '@/utils/token-usage';

const props = defineProps<{ usage: RecordedTokenUsage }>();
const rows = computed(() => tokenUsageRows(props.usage));
</script>
<template>
  <div class="app-usage-details">
    <dl aria-label="模型用量">
      <template v-for="row in rows" :key="row.label">
        <dt>{{ row.label }}</dt>
        <dd>{{ row.value }}</dd>
      </template>
    </dl>
    <p v-if="usage.cache?.partial" role="status">部分步骤未返回缓存指标，数值为已报告部分。</p>
  </div>
</template>
<style scoped lang="scss">
.app-usage-details {
  @apply min-w-0;
  font-size: var(--ui-font-size);
}
dl {
  @apply m-0 grid gap-x-3 gap-y-2;
  grid-template-columns: 6.5rem minmax(0, 1fr);
}
dt,
p {
  color: var(--muted-foreground);
}
dd {
  @apply m-0;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
p {
  @apply mb-0 mt-2;
}
</style>
