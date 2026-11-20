<script setup lang="ts">
import { ref } from 'vue';

const props = withDefaults(defineProps<{ modelValue: string[]; label: string; placeholder?: string }>(), {
  placeholder: undefined
});
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();
const draft = ref('');
const input = ref<HTMLInputElement>();

function commit() {
  const value = draft.value.trim();
  draft.value = '';
  if (value && !props.modelValue.includes(value)) emit('update:modelValue', [...props.modelValue, value]);
}
function remove(value: string) {
  emit(
    'update:modelValue',
    props.modelValue.filter(item => item !== value)
  );
}
function onKeydown(event: KeyboardEvent) {
  // 输入法组合中的回车用于选词，不提交。
  if (event.isComposing) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    commit();
  } else if (event.key === 'Backspace' && !draft.value && props.modelValue.length) {
    remove(props.modelValue.at(-1)!);
  }
}
</script>

<template>
  <div class="app-tag-input" data-slot="app-tag-input" @click.self="input?.focus()">
    <span v-for="value in modelValue" :key="value" class="app-tag-input-tag">
      <span class="app-tag-input-text">{{ value }}</span>
      <button type="button" class="app-tag-input-remove" :aria-label="`移除${label}${value}`" @click="remove(value)">
        <span class="i-mingcute-close-line size-3.5" aria-hidden="true" />
      </button>
    </span>
    <input
      ref="input"
      v-model="draft"
      class="app-tag-input-control"
      :aria-label="`添加${label}`"
      :placeholder="modelValue.length ? undefined : placeholder"
      @keydown="onKeydown"
      @blur="commit"
    />
  </div>
</template>

<style scoped>
.app-tag-input {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  min-width: 0;
  min-height: var(--control-height-sm);
  padding: 3px 6px;
  border: 1px solid var(--input-border);
  border-radius: var(--radius-control);
  background: var(--input);
  cursor: text;
  transition: border-color 150ms;
}
.app-tag-input:hover {
  border-color: var(--input-hover-border);
}
.app-tag-input:focus-within {
  border-color: var(--input-focus-border);
}
.app-tag-input-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 24px;
  padding: 0 2px 0 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control-sm);
  background: var(--surface-muted);
  font-size: var(--ui-font-size);
  color: var(--foreground);
  cursor: default;
}
.app-tag-input-text {
  max-width: 16em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-tag-input-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 3px;
  color: var(--muted-foreground);
}
.app-tag-input-remove:hover {
  background: var(--surface-hover);
  color: var(--foreground);
}
.app-tag-input-control {
  flex: 1;
  min-width: 6em;
  height: 24px;
  padding: 0 2px;
  border: 0;
  background: transparent;
  font-size: var(--ui-font-size);
  color: inherit;
  outline: none;
}
.app-tag-input-control::placeholder {
  color: var(--muted-foreground);
}
</style>
