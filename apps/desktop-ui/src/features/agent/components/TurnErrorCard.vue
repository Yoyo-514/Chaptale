<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';

import { AppButton } from '@/components/AppButton';

import { formatAgentError } from '../error-format';

const props = defineProps<{
  errorMessage?: string;
  canRetry: boolean;
  disabled: boolean;
}>();

const emit = defineEmits<{
  retry: [];
  openModelSettings: [];
}>();

const formatted = computed(() => formatAgentError(props.errorMessage ?? ''));
const detailOpen = ref(false);
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | undefined;

async function copyDetail() {
  if (!formatted.value.detail) return;
  await navigator.clipboard?.writeText(formatted.value.detail);
  copied.value = true;
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copied.value = false;
  }, 1500);
}

onBeforeUnmount(() => clearTimeout(copyTimer));
</script>

<template>
  <section class="agent-turn-error" role="alert">
    <div class="agent-turn-error-header">
      <span class="i-mingcute-warning-line agent-turn-error-icon shrink-0" aria-hidden="true" />
      <p class="agent-turn-error-summary">{{ formatted.summary }}</p>
      <div class="agent-turn-error-actions">
        <AppButton
          v-if="formatted.needsModelSettings"
          type="button"
          size="xs"
          variant="outline"
          @click="emit('openModelSettings')"
        >
          模型设置
        </AppButton>
        <AppButton
          v-if="canRetry"
          type="button"
          size="xs"
          variant="outline"
          :disabled="disabled"
          @click="emit('retry')"
        >
          重试
        </AppButton>
      </div>
    </div>
    <div v-if="formatted.detail" class="agent-turn-error-raw">
      <button
        type="button"
        class="agent-turn-error-toggle"
        :aria-expanded="detailOpen"
        @click="detailOpen = !detailOpen"
      >
        <span class="i-mingcute-right-line agent-turn-error-chevron" aria-hidden="true" />
        <span>{{ detailOpen ? '收起原始报错' : '查看原始报错' }}</span>
      </button>
      <div v-if="detailOpen" class="agent-turn-error-detail">
        <div class="agent-turn-error-detail-bar">
          <AppButton type="button" size="xs" variant="ghost" aria-label="复制原始报错" @click="copyDetail">
            <span
              :class="copied ? 'i-mingcute-check-line' : 'i-mingcute-copy-2-line'"
              class="size-3.5"
              aria-hidden="true"
            />
            <span>{{ copied ? '已复制' : '复制' }}</span>
          </AppButton>
        </div>
        <pre>{{ formatted.detail }}</pre>
      </div>
    </div>
  </section>
</template>

<style lang="scss">
.agent-turn-error {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  padding: 8px 10px 8px 12px;
  border: 1px solid color-mix(in srgb, var(--destructive) 36%, var(--border));
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--destructive) 6%, var(--surface));
}
.agent-turn-error-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}
.agent-turn-error-icon {
  width: 16px;
  height: 16px;
  margin-top: 3px;
  color: var(--destructive);
}
.agent-turn-error-summary {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--foreground);
  font-size: var(--ui-font-size);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.agent-turn-error-actions {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
}
.agent-turn-error-raw {
  padding-left: 24px;
  font-size: var(--ui-caption-size);
}
.agent-turn-error-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 22px;
  padding: 0 4px;
  margin-left: -4px;
  border: 0;
  border-radius: var(--radius-control-sm);
  background: transparent;
  color: var(--muted-foreground);
  font: inherit;
  cursor: pointer;
}
.agent-turn-error-toggle:hover {
  background: var(--surface-hover);
  color: var(--foreground);
}
.agent-turn-error-chevron {
  font-size: var(--ui-font-size);
  transition: transform 150ms ease-out;
}
.agent-turn-error-toggle[aria-expanded='true'] .agent-turn-error-chevron {
  transform: rotate(90deg);
}
.agent-turn-error-detail {
  margin-top: 4px;
  padding: 6px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control-sm);
  background: var(--surface);
}
.agent-turn-error-detail-bar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 2px;
}
.agent-turn-error-detail pre {
  max-height: 12rem;
  overflow: auto;
  margin: 0;
  color: var(--muted-foreground);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  font-size: var(--ui-caption-size);
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
