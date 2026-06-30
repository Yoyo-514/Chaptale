<script setup lang="ts">
import { computed, useAttrs } from 'vue';

import { cn } from '@/lib/utils';
import { buttonVariants } from './button.variants';

const props = withDefaults(
  defineProps<{
    variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
    size?: 'default' | 'sm' | 'lg' | 'icon';
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
  }>(),
  {
    variant: 'default',
    size: 'default',
    type: 'button'
  }
);

const attrs = useAttrs();
const classes = computed(() => cn(buttonVariants({ variant: props.variant, size: props.size }), String(attrs.class ?? '')));
</script>

<template>
  <button :type="props.type" :disabled="props.disabled" :class="classes" data-slot="button">
    <slot />
  </button>
</template>
