<script setup lang="ts">
import { computed } from 'vue';

import type { EditMode, ModelRef } from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { AppForm } from '@/components/AppForm';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTextarea } from '@/components/AppTextarea';
import { AppTooltip } from '@/components/AppTooltip';
import { useSettingsStore } from '@/features/settings';
import { getDesktopApi } from '@/utils/desktop-api';

import { useAgentStore } from '../store';

const agent = useAgentStore();
const settings = useSettingsStore();
const editable = computed(() => agent.connected && !agent.active?.readonly);
const current = computed(() => (agent.active ? agent.active.model : agent.selectedModel));
const modelKey = computed(() =>
  current.value ? JSON.stringify({ provider: current.value.provider, id: current.value.id }) : ''
);
/** 会话用的模型可能已从配置里删掉，这时仍显示它的 ID。 */
const modelPlaceholder = computed(() => (current.value ? `${current.value.id}（未配置）` : '选择模型'));
const placeholder = computed(() =>
  agent.active?.readonly ? '只读历史不能继续对话' : '写下想讨论或推进的事，Ctrl + Enter 发送'
);
const modes: { value: EditMode; label: string }[] = [
  { value: 'discuss', label: '讨论' },
  { value: 'review', label: '审阅' },
  { value: 'direct', label: '直接修改' }
];
function model(value: string) {
  if (value === 'configure') {
    settings.openPanel('llm');
    return;
  }
  const chosen: ModelRef = JSON.parse(value);
  if (agent.active)
    void agent.perform(() => getDesktopApi().agentHost.request('model', { id: agent.activeId!, model: chosen }));
  else agent.selectedModel = chosen;
}
function mode(value: string) {
  const mode = value as EditMode;
  if (agent.active) void agent.perform(() => getDesktopApi().agentHost.request('mode', { id: agent.activeId!, mode }));
  else agent.composeMode = mode;
}
</script>

<template>
  <AppForm class="agent-composer" :disabled="!editable" @submit="agent.send">
    <div class="agent-composer-box agent-column">
      <AppTextarea
        v-model="agent.draft"
        aria-label="消息"
        :rows="2"
        variant="plain"
        resize="auto"
        :placeholder="placeholder"
        @keydown.ctrl.enter.prevent="agent.send"
      />
      <div class="agent-composer-tools">
        <AppSelect
          aria-label="会话模型"
          variant="ghost"
          content-size="md"
          class="agent-model-picker"
          :model-value="modelKey"
          :placeholder="modelPlaceholder"
          @update:model-value="model"
        >
          <AppSelectItem
            v-for="item in agent.state?.models"
            :key="JSON.stringify([item.provider, item.id])"
            :value="JSON.stringify({ provider: item.provider, id: item.id })"
            >{{ item.name }}</AppSelectItem
          >
          <AppSelectItem value="configure">配置模型…</AppSelectItem>
        </AppSelect>
        <AppSelect
          aria-label="修改模式"
          variant="ghost"
          content-size="sm"
          :model-value="agent.active ? agent.active.mode : agent.composeMode"
          @update:model-value="mode"
        >
          <AppSelectItem v-for="item in modes" :key="item.value" :value="item.value">{{ item.label }}</AppSelectItem>
        </AppSelect>
        <span class="flex-1" />
        <AppTooltip v-if="agent.active?.running" text="停止生成">
          <AppButton
            type="button"
            icon
            size="sm"
            variant="ghost"
            aria-label="停止生成"
            @click="agent.perform(() => getDesktopApi().agentHost.request('cancel', { id: agent.activeId! }))"
            ><span class="i-mingcute-stop-fill size-4" aria-hidden="true"
          /></AppButton>
        </AppTooltip>
        <AppTooltip :text="agent.active?.running ? '插话：助手会在当前步骤后读到' : '发送'">
          <AppButton
            class="agent-send-button"
            type="submit"
            icon
            size="sm"
            variant="primary"
            :aria-label="agent.active?.running ? '插话' : '发送'"
            :disabled="!editable || !agent.draft.trim() || (!agent.active && !agent.selectedModel)"
          >
            <span class="i-mingcute-send-plane-line size-4" aria-hidden="true" />
          </AppButton>
        </AppTooltip>
      </div>
    </div>
  </AppForm>
</template>
