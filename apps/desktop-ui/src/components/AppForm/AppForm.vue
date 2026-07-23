<script setup lang="ts">
import { computed, provide, useAttrs } from 'vue';

import { cn } from '@/utils';

import { appFormContextKey } from './context';

defineOptions({
  inheritAttrs: false
});

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    novalidate?: boolean;
    autocomplete?: string;
  }>(),
  {
    disabled: false,
    novalidate: false,
    autocomplete: undefined
  }
);

const emit = defineEmits<{
  submit: [event: SubmitEvent];
}>();

const attrs = useAttrs();
const formClassName = computed(() => cn('app-form', attrs.class));
const formAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});
const isDisabled = computed(() => props.disabled);

provide(appFormContextKey, {
  disabled: isDisabled
});
</script>

<template>
  <form
    v-bind="formAttrs"
    :class="formClassName"
    :novalidate="props.novalidate"
    :autocomplete="props.autocomplete"
    :aria-disabled="props.disabled || undefined"
    :data-disabled="props.disabled || undefined"
    data-slot="app-form"
    @submit.prevent="emit('submit', $event)"
  >
    <slot />
  </form>
</template>

<style scoped lang="scss">
.app-form {
  @apply min-w-0;
}
</style>
