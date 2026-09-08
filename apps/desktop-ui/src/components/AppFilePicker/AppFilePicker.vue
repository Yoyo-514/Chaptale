<script setup lang="ts">
import { ref } from 'vue';

import { AppButton } from '@/components/AppButton';

defineProps<{ accept?: string; disabled?: boolean; label: string }>();
const emit = defineEmits<{ select: [file: File] }>();
const input = ref<HTMLInputElement | null>(null);
function onChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = '';
  if (file) emit('select', file);
}
</script>
<template>
  <span class="app-file-picker">
    <input ref="input" type="file" :accept="accept" :disabled="disabled" hidden @change="onChange" />
    <AppButton :disabled="disabled" @click="input?.click()"
      ><span class="i-mingcute-upload-2-line size-4" aria-hidden="true" />{{ label }}</AppButton
    >
  </span>
</template>
<style scoped>
.app-file-picker {
  display: inline-flex;
  min-width: 0;
}
</style>
