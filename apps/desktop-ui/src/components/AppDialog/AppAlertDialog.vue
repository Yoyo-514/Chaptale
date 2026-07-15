<script setup lang="ts">
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
  AlertDialogTrigger
} from 'reka-ui';
import { computed, useAttrs, useSlots } from 'vue';

import { cn } from '@/utils';

defineOptions({
  inheritAttrs: false
});

const props = withDefaults(
  defineProps<{
    title: string;
    description?: string;
    confirmLabel: string;
    cancelLabel?: string;
    overlayClass?: string;
    contentClass?: string;
  }>(),
  {
    description: undefined,
    cancelLabel: '取消',
    overlayClass: undefined,
    contentClass: undefined
  }
);

const emit = defineEmits<{
  confirm: [];
}>();

const slots = useSlots();
const attrs = useAttrs();
const hasDescription = computed(() => Boolean(props.description || slots.description));
const overlayClassName = computed(() => cn('app-alert-dialog-overlay', props.overlayClass));
const contentClassName = computed(() => cn('app-alert-dialog-content', props.contentClass, attrs.class));
const contentAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});
</script>

<template>
  <AlertDialogRoot>
    <AlertDialogTrigger as-child data-slot="app-alert-dialog-trigger">
      <slot name="trigger" />
    </AlertDialogTrigger>
    <AlertDialogPortal>
      <AlertDialogOverlay :class="overlayClassName" data-slot="app-alert-dialog-overlay" />
      <AlertDialogContent v-bind="contentAttrs" :class="contentClassName" data-slot="app-alert-dialog-content">
        <AlertDialogTitle class="app-alert-dialog-title" data-slot="app-alert-dialog-title">
          <slot name="title">{{ props.title }}</slot>
        </AlertDialogTitle>
        <AlertDialogDescription
          v-if="hasDescription"
          class="app-alert-dialog-description"
          data-slot="app-alert-dialog-description"
        >
          <slot name="description">{{ props.description }}</slot>
        </AlertDialogDescription>
        <slot />
        <div class="app-alert-dialog-actions" data-slot="app-alert-dialog-actions">
          <AlertDialogCancel class="app-alert-dialog-cancel" data-slot="app-alert-dialog-cancel">
            {{ props.cancelLabel }}
          </AlertDialogCancel>
          <AlertDialogAction
            class="app-alert-dialog-confirm"
            data-slot="app-alert-dialog-confirm"
            @click="emit('confirm')"
          >
            {{ props.confirmLabel }}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>

<style lang="scss">
.app-alert-dialog-overlay {
  @apply fixed inset-0 z-$z-modal-backdrop;

  background: var(--overlay-scrim);
  backdrop-filter: var(--blur-acrylic-subtle);
}

.app-alert-dialog-content {
  @apply fixed left-1/2 top-1/2 z-$z-modal w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 border p-5 shadow-$shadow-float;

  background: var(--popover);
  border-color: var(--border);
  border-radius: var(--radius-overlay);
  color: var(--popover-foreground);
}

.app-alert-dialog-title {
  @apply m-0 text-base font-semibold;
}

.app-alert-dialog-description {
  @apply mt-2 mb-0 text-sm leading-6;

  color: var(--muted-foreground);
}

.app-alert-dialog-actions {
  @apply mt-5 flex justify-end gap-2;
}

.app-alert-dialog-cancel,
.app-alert-dialog-confirm {
  @apply px-3 py-2 text-sm font-medium outline-none transition-colors duration-150;

  border-radius: var(--radius-control);
}

.app-alert-dialog-cancel {
  background: var(--surface-muted);
  color: var(--foreground);
}

.app-alert-dialog-cancel:hover {
  background: var(--secondary);
}

.app-alert-dialog-confirm {
  background: var(--destructive);
  color: var(--destructive-foreground);
}

.app-alert-dialog-confirm:hover {
  opacity: 0.9;
}

.app-alert-dialog-cancel:focus-visible,
.app-alert-dialog-confirm:focus-visible {
  box-shadow: var(--input-focus-shadow);
}
</style>
