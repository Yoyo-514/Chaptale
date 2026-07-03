<script setup lang="ts">
import { ToastClose, ToastDescription, ToastProvider, ToastRoot, ToastTitle, ToastViewport } from 'reka-ui';

import { useToastStore } from '../../stores/toast';

const toastStore = useToastStore();

function handleOpenChange(open: boolean, id: number) {
  if (!open) {
    toastStore.dismiss(id);
  }
}
</script>

<template>
  <ToastProvider :duration="4500" swipe-direction="right">
    <ToastRoot
      v-for="toast in toastStore.items"
      :key="toast.id"
      class="app-toast"
      :class="`is-${toast.kind}`"
      @update:open="open => handleOpenChange(open, toast.id)"
    >
      <div class="app-toast-copy">
        <ToastTitle class="app-toast-title">{{ toast.title }}</ToastTitle>
        <ToastDescription v-if="toast.description" class="app-toast-description">
          {{ toast.description }}
        </ToastDescription>
      </div>
      <ToastClose class="app-toast-close" aria-label="关闭通知">
        <span class="i-mingcute-close-line size-3.5" aria-hidden="true" />
      </ToastClose>
    </ToastRoot>
    <ToastViewport class="app-toast-viewport" />
  </ToastProvider>
</template>

<style scoped lang="scss">
.app-toast-viewport {
  @apply fixed bottom-4 right-4 z-[60] m-0 flex w-[22rem] max-w-[calc(100vw-2rem)] list-none flex-col gap-2 p-0 outline-none;
}

.app-toast {
  @apply flex items-start justify-between gap-3 border px-3 py-2.5 shadow-float;

  background: var(--popover);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
  color: var(--popover-foreground);
}

.app-toast.is-error {
  background: var(--destructive-background);
  border-color: var(--destructive);
  color: var(--destructive-background-foreground);
}

.app-toast.is-success {
  border-color: var(--primary-solid);
}

.app-toast-copy {
  @apply flex min-w-0 flex-col gap-1;
}

.app-toast-title {
  @apply text-xs font-semibold leading-4;
}

.app-toast-description {
  @apply m-0 break-all text-xs leading-4 opacity-80;
}

.app-toast-close {
  @apply flex-center size-6 shrink-0 border-0 outline-none transition-opacity duration-150;

  background: transparent;
  color: currentColor;
  opacity: 0.65;
}

.app-toast-close:hover {
  opacity: 1;
}
</style>
