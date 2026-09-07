<script setup lang="ts">
import { SelectItem, SelectItemIndicator, SelectItemText } from 'reka-ui';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { cn } from '@/utils';

const props = withDefaults(
  defineProps<{
    value: string;
    disabled?: boolean;
    itemClass?: string;
    density?: 'sm' | 'md';
  }>(),
  {
    disabled: false,
    itemClass: undefined,
    density: 'md'
  }
);

const itemClassName = computed(() => cn('app-select-item', `app-select-item-${props.density}`, props.itemClass));
const copyElement = ref<HTMLElement>();
const textRevision = ref(0);
let registeredText = '';
let textObserver: MutationObserver | undefined;
onMounted(() => {
  registeredText = copyElement.value?.textContent ?? '';
  textObserver = new MutationObserver(() => {
    const text = copyElement.value?.textContent ?? '';
    if (text === registeredText) return;
    registeredText = text;
    // Reka 在文字节点挂载时登记标签；只重挂文字，保留选中项和焦点。
    textRevision.value += 1;
  });
  if (copyElement.value)
    textObserver.observe(copyElement.value, { characterData: true, childList: true, subtree: true });
});
onBeforeUnmount(() => textObserver?.disconnect());
</script>

<template>
  <SelectItem :class="itemClassName" :value="props.value" :disabled="props.disabled" data-slot="app-select-item">
    <span ref="copyElement" class="app-select-item-copy" data-slot="app-select-item-copy">
      <SelectItemText :key="textRevision" class="app-select-item-text" data-slot="app-select-item-text">
        <slot />
      </SelectItemText>
    </span>
    <SelectItemIndicator class="app-select-item-indicator" data-slot="app-select-item-indicator">
      <span class="i-mingcute-check-line" aria-hidden="true" />
    </SelectItemIndicator>
  </SelectItem>
</template>

<style scoped lang="scss">
.app-select-item {
  @apply relative cursor-pointer outline-none transition-colors duration-150;

  border-radius: var(--radius-control-sm);
  color: var(--foreground);
}

.app-select-item-sm {
  @apply py-1.5 pr-7 pl-2.5;
  font-size: var(--ui-font-size);
  line-height: 20px;
}

.app-select-item-md {
  @apply py-1.5 pr-7 pl-2 text-sm;
}

.app-select-item-copy {
  @apply flex min-w-0 flex-col gap-0.5;
}

.app-select-item-text {
  @apply flex min-w-0 flex-col gap-0.5;
  overflow-wrap: anywhere;
}

.app-select-item-indicator {
  @apply flex-center absolute top-1/2 right-2 -translate-y-1/2 text-xs;
}

.app-select-item[data-highlighted],
.app-select-item:hover {
  background: var(--surface-hover);
}

.app-select-item[data-state='checked'] {
  background: var(--secondary);
  color: var(--secondary-foreground);
}

.app-select-item[data-disabled],
.app-select-item[aria-disabled='true'] {
  @apply cursor-not-allowed opacity-65;
}

.app-select-item[data-disabled]:not([data-state='checked']):hover,
.app-select-item[aria-disabled='true']:not([data-state='checked']):hover {
  background: transparent;
}
</style>
