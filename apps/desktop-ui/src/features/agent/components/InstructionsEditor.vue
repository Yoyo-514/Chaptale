<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';

import type { AgentInstructions } from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppForm } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTextarea } from '@/components/AppTextarea';

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
      <AppScrollArea class="instruction-list"
        ><nav aria-label="指令条目">
          <button
            v-for="(entry, index) in entries"
            :key="index"
            type="button"
            class="instruction-list-item"
            :aria-label="`编辑${entry.name || '未命名指令'}`"
            :aria-current="selected === index ? 'true' : undefined"
            @click="selected = index"
          >
            <span class="instruction-order">{{ index + 1 }}</span>
            <span class="instruction-list-name">{{ entry.name || '未命名指令' }}</span>
            <span v-if="!entry.enabled" class="instruction-off">已停用</span>
          </button>
          <AppButton type="button" variant="ghost" :disabled="disabled" @click="add">
            <span class="i-mingcute-add-line size-4" aria-hidden="true" />添加指令
          </AppButton>
        </nav></AppScrollArea
      >
      <fieldset v-if="current" :disabled="disabled" class="instruction-detail agent-form">
        <div class="agent-row instruction-actions">
          <label class="agent-check"
            ><AppCheckbox
              :model-value="current.enabled"
              :disabled="disabled"
              aria-label="启用这条指令"
              @update:model-value="current.enabled = $event === true"
            />启用这条指令</label
          >
          <div class="agent-row">
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
            <AppButton type="button" icon size="sm" variant="ghost" aria-label="删除指令" @click="remove"
              ><span class="i-mingcute-delete-2-line size-4" aria-hidden="true"
            /></AppButton>
          </div>
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
