<script setup lang="ts">
import { computed } from 'vue';

import type { EditorContext } from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';

const props = defineProps<{ quote: EditorContext }>();
const emit = defineEmits<{ remove: [] }>();

const label = computed(() => `${props.quote.section === 'resource' ? '资料' : '文稿'}《${props.quote.title}》选区`);
const preview = computed(() => (props.quote.selection ?? '').replace(/\s+/g, ' ').trim());
</script>

<template>
  <div class="agent-quote-chip" role="group" :aria-label="label">
    <span class="i-mingcute-quote-left-line size-3.5 shrink-0" aria-hidden="true" />
    <span class="agent-quote-chip-label">{{ label }}</span>
    <span v-if="preview" class="agent-quote-chip-preview">{{ preview }}</span>
    <AppButton
      type="button"
      icon
      size="xs"
      variant="ghost"
      class="agent-quote-chip-remove"
      aria-label="移除引用"
      @click="emit('remove')"
    >
      <span class="i-mingcute-close-line size-3.5" aria-hidden="true" />
    </AppButton>
  </div>
</template>
