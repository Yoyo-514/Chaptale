<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui';
import { computed, useAttrs, useSlots } from 'vue';

import { cn } from '@/utils';

defineOptions({
  inheritAttrs: false
});

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    contentSize?: 'md' | 'lg';
    contentClass?: string;
    overlayClass?: string;
    closeLabel?: string;
    showClose?: boolean;
  }>(),
  {
    description: undefined,
    contentSize: 'md',
    contentClass: undefined,
    overlayClass: undefined,
    closeLabel: '关闭',
    showClose: true
  }
);

const emit = defineEmits<{
  'update:open': [open: boolean];
}>();

const slots = useSlots();
const attrs = useAttrs();
const hasDescription = computed(() => Boolean(props.description || slots.description));
const overlayClassName = computed(() => cn('app-dialog-overlay', props.overlayClass));
const contentClassName = computed(() =>
  cn('app-dialog-content', `app-dialog-content-${props.contentSize}`, props.contentClass, attrs.class)
);
const contentAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});

function closeDialog() {
  emit('update:open', false);
}
</script>

<template>
  <DialogRoot :open="props.open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay :class="overlayClassName" data-slot="app-dialog-overlay" />
      <DialogContent v-bind="contentAttrs" :class="contentClassName" data-slot="app-dialog-content">
        <div class="app-dialog-header" data-slot="app-dialog-header">
          <div class="app-dialog-heading" data-slot="app-dialog-heading">
            <DialogTitle class="app-dialog-title" data-slot="app-dialog-title">
              <slot name="title">{{ props.title }}</slot>
            </DialogTitle>
            <DialogDescription v-if="hasDescription" class="app-dialog-description" data-slot="app-dialog-description">
              <slot name="description">{{ props.description }}</slot>
            </DialogDescription>
          </div>
          <DialogClose
            v-if="props.showClose"
            class="app-dialog-close"
            :aria-label="props.closeLabel"
            data-slot="app-dialog-close"
          >
            <span class="i-mingcute-close-line" aria-hidden="true" />
          </DialogClose>
        </div>

        <slot :close="closeDialog" />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style lang="scss">
.app-dialog-overlay {
  @apply fixed inset-0 z-$z-modal-backdrop;

  background: rgb(0 0 0 / 0.28);
}

.app-dialog-content {
  @apply fixed left-1/2 top-1/2 z-$z-modal flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border p-4 shadow-$shadow-float outline-none;

  background: var(--popover);
  border-color: var(--border-subtle);
  border-radius: var(--radius-overlay);
  color: var(--popover-foreground);
}

.app-dialog-content-md {
  @apply max-h-[min(32rem,calc(100vh-4rem))] w-[min(42rem,calc(100vw-3rem))];
}

.app-dialog-content-lg {
  @apply max-h-[min(44rem,calc(100vh-4rem))] w-[min(52rem,calc(100vw-3rem))];
}

.app-dialog-header {
  @apply -mx-4 flex items-center justify-between gap-3 border-b px-4 pb-3;

  border-color: var(--border-subtle);
}

.app-dialog-heading {
  @apply min-w-0;
}

.app-dialog-title {
  @apply m-0 text-sm font-semibold;
}

.app-dialog-description {
  @apply mt-1 text-xs leading-5;

  color: var(--muted-foreground);
}

.app-dialog-close {
  @apply flex-center size-7 shrink-0 border text-sm outline-none transition-colors duration-150;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: var(--radius-control);
  color: var(--muted-foreground);
}

.app-dialog-close:hover {
  background: var(--secondary);
  color: var(--secondary-foreground);
}

.app-dialog-close:focus-visible {
  box-shadow: var(--input-focus-shadow);
}
</style>
