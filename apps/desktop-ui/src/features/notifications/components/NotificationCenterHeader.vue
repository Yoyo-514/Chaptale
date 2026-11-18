<script setup lang="ts">
import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';

const props = defineProps<{
  title: string;
  canClear: boolean;
}>();

const emit = defineEmits<{
  clear: [];
  close: [];
}>();
</script>

<template>
  <header class="notification-center-header">
    <h2 class="notification-center-title">{{ props.title }}</h2>
    <div class="notification-center-actions">
      <AppTooltip text="清空通知">
        <AppButton
          icon
          variant="ghost"
          size="sm"
          type="button"
          :disabled="!props.canClear"
          aria-label="清空通知"
          @click="emit('clear')"
        >
          <span class="i-mingcute-delete-2-line size-4" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
      <AppTooltip text="隐藏通知中心">
        <AppButton icon variant="ghost" size="sm" type="button" aria-label="隐藏通知中心" @click="emit('close')">
          <span class="i-mingcute-down-line size-4" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
    </div>
  </header>
</template>

<style scoped lang="scss">
.notification-center-header {
  @apply flex min-h-9 items-center justify-between gap-3 border-b px-2.5 py-1.5;

  border-color: var(--border-subtle);
}

.notification-center-title {
  @apply m-0 min-w-0 flex-1 truncate text-xs font-medium leading-5;

  color: var(--popover-foreground);
}

.notification-center-actions {
  @apply flex shrink-0 items-center gap-0.5;
}
</style>
