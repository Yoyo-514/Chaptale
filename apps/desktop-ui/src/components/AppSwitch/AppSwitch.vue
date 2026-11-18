<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui';
import { computed, inject } from 'vue';

import { appFormContextKey } from '../AppForm/context';

const props = withDefaults(defineProps<{ modelValue?: boolean; disabled?: boolean }>(), {
  modelValue: false,
  disabled: false
});

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

const formContext = inject(appFormContextKey, undefined);
const isDisabled = computed(() => props.disabled || formContext?.disabled.value === true);
</script>

<template>
  <SwitchRoot
    class="app-switch"
    :model-value="props.modelValue"
    :disabled="isDisabled"
    data-slot="app-switch"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <SwitchThumb class="app-switch-thumb" />
  </SwitchRoot>
</template>

<style lang="scss">
.app-switch {
  @apply relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center border-0 p-0 outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60;

  background: var(--border-strong);
  border-radius: var(--radius-pill);
}

.app-switch[data-state='checked'] {
  background: var(--primary-solid);
}

.app-switch:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.app-switch-thumb {
  @apply block size-3 translate-x-0.5 transition-transform duration-150;

  background: var(--surface-elevated);
  border-radius: var(--radius-pill);
}

.app-switch[data-state='checked'] > .app-switch-thumb {
  @apply translate-x-3.5;

  background: var(--primary-solid-foreground);
}

@media (prefers-reduced-motion: reduce) {
  .app-switch,
  .app-switch-thumb {
    transition: none;
  }
}
</style>
