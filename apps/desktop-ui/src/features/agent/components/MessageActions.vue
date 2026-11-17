<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';

import type { MessageBranch } from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';

const props = defineProps<{
  copyText?: string;
  branch?: MessageBranch;
  canEdit?: boolean;
  canRetry?: boolean;
  disabled?: boolean;
  alwaysVisible?: boolean;
  align?: 'start' | 'end';
}>();

const emit = defineEmits<{
  edit: [];
  retry: [];
  switchBranch: [leafId: string];
}>();

const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | undefined;

async function copy() {
  if (!props.copyText) return;
  await navigator.clipboard?.writeText(props.copyText);
  copied.value = true;
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copied.value = false;
  }, 1500);
}

onBeforeUnmount(() => clearTimeout(copyTimer));
</script>

<template>
  <div
    v-if="(branch && branch.total > 1) || copyText || canEdit || canRetry"
    class="agent-message-actions"
    :class="align === 'end' ? 'is-end' : 'is-start'"
  >
    <div
      v-if="copyText || canEdit || canRetry"
      class="agent-message-action-buttons"
      :class="{ 'is-visible': alwaysVisible }"
    >
      <AppTooltip v-if="copyText" :text="copied ? '已复制' : '复制'">
        <AppButton type="button" icon size="xs" variant="ghost" aria-label="复制消息" @click="copy">
          <span
            :class="copied ? 'i-mingcute-check-line' : 'i-mingcute-copy-2-line'"
            class="size-3.5"
            aria-hidden="true"
          />
        </AppButton>
      </AppTooltip>
      <AppTooltip v-if="canEdit" text="编辑">
        <AppButton
          type="button"
          icon
          size="xs"
          variant="ghost"
          aria-label="编辑消息"
          :disabled="disabled"
          @click="emit('edit')"
        >
          <span class="i-mingcute-edit-line size-3.5" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
      <AppTooltip v-if="canRetry" text="重试">
        <AppButton
          type="button"
          icon
          size="xs"
          variant="ghost"
          aria-label="重试消息"
          :disabled="disabled"
          @click="emit('retry')"
        >
          <span class="i-mingcute-refresh-2-line size-3.5" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
    </div>
    <div v-if="branch && branch.total > 1" class="agent-branch-switcher" role="group" aria-label="分支切换">
      <AppTooltip text="上一分支">
        <AppButton
          type="button"
          icon
          size="xs"
          variant="ghost"
          aria-label="上一分支"
          :disabled="disabled || !branch.prevLeafId"
          @click="emit('switchBranch', branch.prevLeafId!)"
        >
          <span class="i-mingcute-left-line size-3.5" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
      <span class="agent-branch-count">{{ branch.index }} / {{ branch.total }}</span>
      <AppTooltip text="下一分支">
        <AppButton
          type="button"
          icon
          size="xs"
          variant="ghost"
          aria-label="下一分支"
          :disabled="disabled || !branch.nextLeafId"
          @click="emit('switchBranch', branch.nextLeafId!)"
        >
          <span class="i-mingcute-right-line size-3.5" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
    </div>
  </div>
</template>

<style lang="scss">
.agent-message-actions {
  display: flex;
  min-height: 24px;
  align-items: center;
  gap: 4px;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.agent-message-actions.is-end {
  justify-content: flex-end;
}
.agent-message-actions.is-start {
  width: 100%;
  justify-content: flex-start;
}
.agent-message-actions.is-start .agent-branch-switcher {
  margin-left: auto;
}
.agent-branch-switcher {
  display: inline-flex;
  align-items: center;
  gap: 1px;
}
.agent-branch-count {
  padding: 0 2px;
  font-variant-numeric: tabular-nums;
  user-select: none;
}
.agent-message-action-buttons {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 120ms ease-out;
}
.agent-message-action-buttons.is-visible,
.agent-user:hover .agent-message-action-buttons,
.agent-user:focus-within .agent-message-action-buttons,
.agent-assistant:hover .agent-message-action-buttons,
.agent-assistant:focus-within .agent-message-action-buttons {
  opacity: 1;
}
@media (hover: none) {
  .agent-message-action-buttons {
    opacity: 1;
  }
}
</style>
