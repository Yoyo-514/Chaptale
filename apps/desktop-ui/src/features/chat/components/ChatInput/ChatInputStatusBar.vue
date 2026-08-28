<script setup lang="ts">
import { computed } from 'vue';

import type { ChaptaleReasoningEffort } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppDropdownMenu, AppDropdownMenuItem } from '@/components/AppDropdownMenu';
import { AppTooltip } from '@/components/AppTooltip';
import { REASONING_EFFORT_LABELS, REASONING_EFFORT_VALUES } from '@/utils/reasoning-effort';

/** 「跟随模型」在菜单里需要一个真实值：空串会被当作未选中。 */
const FOLLOW_MODEL = 'follow-model';
const FOLLOW_MODEL_LABEL = '跟随模型';

const REASONING_EFFORT_OPTIONS: { value: string; label: string }[] = [
  { value: FOLLOW_MODEL, label: FOLLOW_MODEL_LABEL },
  ...REASONING_EFFORT_VALUES.map(value => ({ value, label: REASONING_EFFORT_LABELS[value] }))
];

const props = defineProps<{
  modelLabel: string;
  workspaceLabel: string;
  /** 空串表示跟随模型自己配的档位。 */
  reasoningEffort: ChaptaleReasoningEffort | '';
}>();

const emit = defineEmits<{
  openSettings: [section: 'workspace' | 'llm'];
  selectReasoningEffort: [value: ChaptaleReasoningEffort | ''];
}>();

const selectedEffortValue = computed(() => props.reasoningEffort || FOLLOW_MODEL);
// 跟随模型态显示“推理”而非某个具体档位名——写成 medium 会让作者以为自己选过。
const effortLabel = computed(() => props.reasoningEffort || '推理');

function selectReasoningEffort(value: string) {
  emit('selectReasoningEffort', value === FOLLOW_MODEL ? '' : (value as ChaptaleReasoningEffort));
}
</script>

<template>
  <div class="chat-status-bar">
    <AppTooltip text="打开模型设置" side="top">
      <AppButton
        variant="ghost"
        size="xs"
        class="chat-status-item"
        type="button"
        aria-label="打开模型设置"
        @click="emit('openSettings', 'llm')"
      >
        <span class="i-mingcute-ai-line" aria-hidden="true" />
        <span class="chat-status-text">{{ props.modelLabel }}</span>
      </AppButton>
    </AppTooltip>
    <!-- 档位紧挨模型且不加分隔线：它是"这个模型这次想多深"，属于模型那一组信息。 -->
    <AppDropdownMenu content-size="sm" align="start">
      <template #trigger>
        <AppButton
          variant="ghost"
          size="xs"
          class="chat-status-effort"
          type="button"
          :selected="Boolean(props.reasoningEffort)"
          aria-label="选择本轮推理档位"
          :title="props.reasoningEffort ? `本轮推理档位：${props.reasoningEffort}` : '本轮推理档位跟随模型配置'"
        >
          <span class="i-mingcute-brain-line" aria-hidden="true" />
          <span class="chat-status-text">{{ effortLabel }}</span>
        </AppButton>
      </template>
      <AppDropdownMenuItem
        v-for="option in REASONING_EFFORT_OPTIONS"
        :key="option.value"
        density="sm"
        :active="option.value === selectedEffortValue"
        @select="selectReasoningEffort(option.value)"
      >
        {{ option.label }}
      </AppDropdownMenuItem>
    </AppDropdownMenu>
    <span class="chat-status-divider" aria-hidden="true" />
    <AppTooltip text="打开工作区设置" side="top">
      <AppButton
        variant="ghost"
        size="xs"
        class="chat-status-item"
        type="button"
        aria-label="打开工作区设置"
        @click="emit('openSettings', 'workspace')"
      >
        <span class="i-mingcute-folder-line" aria-hidden="true" />
        <span class="chat-status-text">{{ props.workspaceLabel }}</span>
      </AppButton>
    </AppTooltip>
  </div>
</template>

<style scoped lang="scss">
.chat-status-bar {
  @apply mt-1.5 flex select-none items-center gap-1 px-1 text-xs;

  color: var(--muted-foreground);
}

.chat-status-item {
  @apply min-w-0 flex-1 justify-start;
}

/* 档位文案很短，不参与等分：占掉三分之一只会把模型与工作区挤成省略号。 */
.chat-status-effort {
  @apply min-w-0 shrink-0 justify-start;
}

.chat-status-text {
  @apply min-w-0 truncate;
}

.chat-status-divider {
  @apply h-3 w-px shrink-0;

  background: var(--input-border);
}
</style>
