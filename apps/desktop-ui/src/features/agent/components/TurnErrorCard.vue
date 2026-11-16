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
