<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppInput } from '@/components/AppInput';

const props = defineProps<{
  open: boolean;
  matchCount: number;
  activeMatchIndex: number;
}>();

const query = defineModel<string>('query', { required: true });

const emit = defineEmits<{
  close: [];
  next: [];
  previous: [];
}>();

const inputWrapperRef = ref<HTMLElement | null>(null);

watch(
  () => props.open,
  async open => {
    if (open) {
      await nextTick();
      inputWrapperRef.value?.querySelector('input')?.focus();
    }
  }
);

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault();

    if (event.shiftKey) {
      emit('previous');
    } else {
      emit('next');
    }
  } else if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
  }
}
</script>

<template>
  <div v-if="props.open" ref="inputWrapperRef" class="chat-search-bar" role="search" @keydown="handleKeydown">
    <span class="i-mingcute-search-line chat-search-icon" aria-hidden="true" />
    <AppInput v-model="query" class="chat-search-input" placeholder="搜索会话内容..." aria-label="搜索会话内容" />
    <span class="chat-search-count" aria-live="polite">
      {{ props.matchCount > 0 ? `${props.activeMatchIndex + 1} / ${props.matchCount}` : '无结果' }}
    </span>
    <AppButton icon variant="ghost" size="xs" type="button" aria-label="上一个结果" @click="emit('previous')">
      <span class="i-mingcute-up-line size-4" aria-hidden="true" />
    </AppButton>
    <AppButton icon variant="ghost" size="xs" type="button" aria-label="下一个结果" @click="emit('next')">
      <span class="i-mingcute-down-line size-4" aria-hidden="true" />
    </AppButton>
    <AppButton icon variant="ghost" size="xs" type="button" aria-label="关闭搜索" @click="emit('close')">
      <span class="i-mingcute-close-line size-4" aria-hidden="true" />
    </AppButton>
  </div>
</template>

<style scoped lang="scss">
.chat-search-bar {
  @apply mx-auto mb-2 flex w-full items-center gap-1.5 rounded-xl border p-1.5 pl-3 shadow-$shadow-float md:w-3xl;

  background: var(--popover);
  border-color: var(--border-subtle);
}

.chat-search-icon {
  @apply shrink-0 text-sm;

  color: var(--muted-foreground);
}

.chat-search-input {
  @apply min-w-0 flex-1;
}

.chat-search-count {
  @apply shrink-0 whitespace-nowrap px-1 text-xs tabular-nums;

  color: var(--muted-foreground);
}
</style>
