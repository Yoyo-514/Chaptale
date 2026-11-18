<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';

import type { AgentInstructions } from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { AppForm } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppSwitch } from '@/components/AppSwitch';
import { AppTextarea } from '@/components/AppTextarea';
import { AppTooltip } from '@/components/AppTooltip';

const props = withDefaults(
  defineProps<{ entries: AgentInstructions; disabled?: boolean; label: string; layout?: 'split' | 'stacked' }>(),
  { disabled: false, layout: 'split' }
);
const emit = defineEmits<{ save: [entries: AgentInstructions] }>();
const entries = ref<AgentInstructions>([]);
const selected = ref(0);
const prefix = useId();
const current = computed(() => entries.value[selected.value]);
const incomplete = computed(() => entries.value.findIndex(entry => !entry.name.trim() || !entry.text.trim()));
watch(
  () => JSON.stringify(props.entries),
  value => {
    entries.value = JSON.parse(value);
    selected.value = Math.max(0, Math.min(selected.value, entries.value.length - 1));
  },
  { immediate: true }
);
function add() {
  entries.value.push({ name: '', role: 'system', enabled: true, text: '' });
  selected.value = entries.value.length - 1;
}
function move(offset: number) {
  const [entry] = entries.value.splice(selected.value, 1);
  selected.value += offset;
  entries.value.splice(selected.value, 0, entry);
}
function remove() {
  entries.value.splice(selected.value, 1);
  selected.value = Math.max(0, Math.min(selected.value, entries.value.length - 1));
}
</script>

<template>
  <AppForm
    class="instruction-editor"
    @submit="
      emit(
        'save',
        entries.map(entry => ({ ...entry }))
      )
    "
  >
    <div class="instruction-editor-layout" :class="`is-${props.layout}`">
      <!-- 堆叠布局里排在指令之前、随整页一起滚动的内容。 -->
      <slot name="lead" />
      <AppScrollArea class="instruction-list"
        ><nav aria-label="指令条目">
          <div
            v-for="(entry, index) in entries"
            :key="index"
            class="instruction-list-row"
            :class="{ 'is-selected': selected === index, 'is-off': !entry.enabled }"
          >
            <button
              type="button"
              class="instruction-list-item"
              :aria-label="`编辑${entry.name || '未命名指令'}`"
              :aria-current="selected === index ? 'true' : undefined"
              @click="selected = index"
            >
              <span class="instruction-order">{{ index + 1 }}</span>
              <span class="instruction-list-name">{{ entry.name || '未命名指令' }}</span>
            </button>
            <AppSwitch
              :model-value="entry.enabled"
              :disabled="disabled"
              :aria-label="`启用${entry.name || '未命名指令'}`"
              @update:model-value="entry.enabled = $event"
            />
          </div>
          <AppButton type="button" variant="ghost" :disabled="disabled" @click="add">
            <span class="i-mingcute-add-line size-4" aria-hidden="true" />添加指令
          </AppButton>
        </nav></AppScrollArea
      >
      <fieldset v-if="current" :disabled="disabled" class="instruction-detail agent-form">
        <div class="agent-row instruction-actions">
          <AppTooltip text="上移指令">
            <AppButton
              type="button"
              icon
              size="sm"
              variant="ghost"
              aria-label="上移指令"
              :disabled="selected === 0"
              @click="move(-1)"
              ><span class="i-mingcute-arrow-up-line size-4" aria-hidden="true"
            /></AppButton>
          </AppTooltip>
          <AppTooltip text="下移指令">
            <AppButton
              type="button"
              icon
              size="sm"
              variant="ghost"
              aria-label="下移指令"
              :disabled="selected === entries.length - 1"
              @click="move(1)"
              ><span class="i-mingcute-arrow-down-line size-4" aria-hidden="true"
            /></AppButton>
          </AppTooltip>
          <AppTooltip text="删除指令">
            <AppButton type="button" icon size="sm" variant="ghost" aria-label="删除指令" @click="remove"
              ><span class="i-mingcute-delete-2-line size-4" aria-hidden="true"
            /></AppButton>
          </AppTooltip>
        </div>
        <label :for="`${prefix}-name`">名称</label>
        <AppInput
          :id="`${prefix}-name`"
          v-model="current.name"
          :disabled="disabled"
          required
          placeholder="例如：交流方式"
        />
        <label :for="`${prefix}-text`">指令内容</label>
        <AppTextarea
          :id="`${prefix}-text`"
          v-model="current.text"
          class="instruction-content"
          :disabled="disabled"
          resize="none"
          required
          spellcheck="false"
          placeholder="写下希望助手遵循的要求…"
        />
        <details class="instruction-advanced">
          <summary>高级选项</summary>
          <label :for="`${prefix}-role`">消息角色</label>
          <AppSelect
            :id="`${prefix}-role`"
            :model-value="current.role"
            :disabled="disabled"
            @update:model-value="current.role = $event as 'system' | 'user' | 'assistant'"
          >
            <AppSelectItem value="system">系统指令</AppSelectItem><AppSelectItem value="user">用户消息</AppSelectItem
            ><AppSelectItem value="assistant">助手消息</AppSelectItem>
          </AppSelect>
        </details>
      </fieldset>
      <div v-else class="agent-empty-small">添加第一条指令，约定这次如何协作。</div>
    </div>
    <footer class="instruction-save">
      <span v-if="incomplete >= 0" class="agent-empty-small">请补全第 {{ incomplete + 1 }} 条指令的名称和内容。</span>
      <AppButton type="submit" :disabled="disabled || incomplete >= 0">{{ label }}</AppButton>
    </footer>
  </AppForm>
</template>

<style lang="scss">
.instruction-save {
  display: flex;
  min-height: 56px;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--border-subtle);
}
.instruction-save > span {
  margin-right: auto;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.instruction-list-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
  padding-right: 8px;
  border-radius: var(--radius-control-sm);
}
.instruction-list-row:hover {
  background: var(--surface-hover);
}
.instruction-list-row.is-selected {
  background: var(--secondary);
}
.instruction-list-row.is-selected .instruction-list-item {
  color: var(--primary-solid);
}
.instruction-list-row.is-off .instruction-list-name {
  color: var(--muted-foreground);
}
.instruction-editor {
  display: flex;
  min-height: 0;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
.instruction-editor-layout {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(7rem, 26%) minmax(0, 1fr);
  border-top: 1px solid var(--border-subtle);
}
.instruction-list {
  min-height: 0;
  padding: 8px;
  border-right: 1px solid var(--border-subtle);
}
.instruction-list-item {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 8px;
  padding: 10px 8px;
  border: 0;
  border-radius: var(--radius-control-sm);
  background: transparent;
  color: var(--foreground);
  font-size: var(--ui-font-size);
  text-align: left;
  cursor: pointer;
}
.instruction-order {
  flex-shrink: 0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  font-variant-numeric: tabular-nums;
}
.instruction-list-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.instruction-detail {
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 12px 16px;
  border: 0;
  gap: 8px;
}
.instruction-actions {
  justify-content: flex-end;
}
.instruction-content {
  min-height: 8rem;
  flex: 1;
  line-height: 1.75;
}
.instruction-advanced {
  flex-shrink: 0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.instruction-advanced summary {
  padding-block: 4px;
  cursor: pointer;
}
.instruction-advanced label {
  margin-block: 8px 4px;
}
/* 窄栏里的指令：条目列表在上、编辑区在下，整列一起滚动，保存栏留在底部。 */
.instruction-editor-layout.is-stacked {
  display: flex;
  flex-direction: column;
  overflow: auto;
  border-top: 0;
}
.instruction-editor-layout.is-stacked > .instruction-list {
  flex-shrink: 0;
  border-right: 0;
  border-block: 1px solid var(--border-subtle);
}
.instruction-editor-layout.is-stacked > .instruction-detail {
  flex: 1 0 auto;
  overflow: visible;
}
.instruction-editor-layout.is-stacked .instruction-content {
  min-height: 12rem;
}
.instruction-editor-layout.is-stacked .instruction-list-item {
  padding-block: 6px;
}
</style>
