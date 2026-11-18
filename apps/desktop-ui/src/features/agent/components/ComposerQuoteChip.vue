<script setup lang="ts">
import { computed } from 'vue';

import type { EditorContext } from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';

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
    <AppTooltip text="移除引用">
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
    </AppTooltip>
  </div>
</template>

<style lang="scss">
.agent-quote-chip {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 6px 12px;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.agent-quote-chip-label {
  flex-shrink: 0;
  color: var(--foreground);
  font-weight: 500;
}
.agent-quote-chip-preview {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-quote-chip-remove {
  margin-left: auto;
  flex-shrink: 0;
}
</style>
