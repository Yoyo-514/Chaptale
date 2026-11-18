<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';
import { computed } from 'vue';

import type { SessionUsage } from '@chaptale/agent-host/protocol';

const props = defineProps<{ usage?: SessionUsage }>();
const numbers = new Intl.NumberFormat('zh-CN');
const format = (value: number | null | undefined) =>
  value === null || value === undefined ? '未知' : numbers.format(value);
const label = computed(() => {
  const percent = props.usage?.context?.percent;
  return percent === null || percent === undefined ? '上下文未知' : `上下文约 ${Math.round(percent)}%`;
});
</script>

<template>
  <PopoverRoot>
    <PopoverTrigger type="button" class="agent-usage-trigger" aria-label="会话用量">{{ label }}</PopoverTrigger>
    <PopoverPortal>
      <PopoverContent class="agent-usage-details" side="top" align="end" :side-offset="6">
        <h3>本会话累计用量</h3>
        <dl>
          <dt>输入 token</dt>
          <dd>{{ format(usage?.input) }}</dd>
          <dt>缓存读取 token</dt>
          <dd>{{ format(usage?.cacheRead) }}</dd>
          <dt>缓存写入 token</dt>
          <dd>{{ format(usage?.cacheWrite) }}</dd>
          <dt>输出 token</dt>
          <dd>{{ format(usage?.output) }}</dd>
          <dt>上下文约占／窗口</dt>
          <dd>{{ format(usage?.context?.tokens) }} / {{ format(usage?.context?.contextWindow) }}</dd>
        </dl>
        <p>按 SDK 记录统计，服务未报告的项目可能记为 0</p>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style lang="scss">
.agent-usage-trigger {
  border: 0;
  border-radius: var(--radius-control-sm);
  background: transparent;
  color: var(--muted-foreground);
  padding: 3px 6px;
  font-size: var(--ui-caption-size);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  &:hover,
  &[data-state='open'] {
    background: var(--surface-hover);
  }
}
.agent-usage-details {
  z-index: var(--z-popover);
  width: 19rem;
  max-width: calc(100vw - 24px);
  padding: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control);
  background: var(--popover);
  color: var(--popover-foreground);
  box-shadow: var(--shadow-float);
  font-size: var(--ui-caption-size);
  h3 {
    margin: 0 0 10px;
    font-size: var(--ui-font-size);
    font-weight: 600;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 12px;
    margin: 0;
  }
  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  p {
    margin: 12px 0 0;
    color: var(--muted-foreground);
    line-height: 1.6;
  }
}
</style>
