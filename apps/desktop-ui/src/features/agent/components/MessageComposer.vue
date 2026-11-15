<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import type { EditMode, ModelRef } from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { AppForm } from '@/components/AppForm';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTextarea } from '@/components/AppTextarea';
import { AppTooltip } from '@/components/AppTooltip';
import { useSettingsStore } from '@/features/settings';
import { getDesktopApi } from '@/utils/desktop-api';

import { useAgentStore } from '../store';
import ComposerQuoteChip from './ComposerQuoteChip.vue';
import SessionUsage from './SessionUsage.vue';

const agent = useAgentStore();
const settings = useSettingsStore();
const textarea = ref<InstanceType<typeof AppTextarea>>();
watch(
  () => agent.composerFocusVersion,
  async () => {
    await nextTick();
    textarea.value?.focus();
  }
);
const editable = computed(() => agent.connected && !agent.creating && !agent.active?.readonly);
const current = computed(() => (agent.active ? agent.active.model : agent.selectedModel));
const modelKey = computed(() =>
  current.value ? JSON.stringify({ provider: current.value.provider, id: current.value.id }) : ''
);
/** 会话用的模型可能已从配置里删掉，这时仍显示它的 ID。 */
const modelPlaceholder = computed(() => (current.value ? `${current.value.id}（未配置）` : '选择模型'));
const placeholder = computed(() => {
  if (agent.creating) return '正在创建会话…';
  if (agent.active?.readonly) return '只读历史不能继续对话';
  if (agent.active?.compacting) return '正在压缩，可以先写下下一条消息';
  return agent.active?.running
    ? 'Ctrl + Enter 插话，Ctrl + Shift + Enter 稍后处理'
    : '写下想讨论或推进的事，Ctrl + Enter 发送';
});
const canQueueWhileRunning = computed(() =>
  Boolean(agent.active?.running && !agent.active.compacting && editable.value && agent.draft.trim())
);
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
  event.preventDefault();
  void agent.send(event.shiftKey ? 'followUp' : 'steer');
}
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
  <AppForm class="agent-composer" :disabled="!editable" @submit="agent.send('steer')">
    <div class="agent-composer-box agent-column">
      <ComposerQuoteChip v-if="agent.quotedSelection" :quote="agent.quotedSelection" @remove="agent.clearQuote()" />
      <AppTextarea
        ref="textarea"
        v-model="agent.draft"
        aria-label="消息"
        :rows="2"
        variant="plain"
        resize="auto"
        :placeholder="placeholder"
        @keydown="onKeydown"
      />
      <div class="agent-composer-tools">
        <AppSelect
          aria-label="会话模型"
          variant="ghost"
          content-size="md"
          class="agent-model-picker"
          :disabled="agent.active?.running"
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
        <template v-if="agent.active?.running">
          <template v-if="canQueueWhileRunning">
            <AppTooltip text="稍后处理 (Ctrl+Shift+Enter)">
              <AppButton
                type="button"
                icon
                size="sm"
                variant="ghost"
                aria-label="稍后处理"
                @click="agent.send('followUp')"
              >
                <span class="i-mingcute-time-line size-4" aria-hidden="true" />
              </AppButton>
            </AppTooltip>
            <AppTooltip text="立即插话 (Ctrl+Enter)">
              <AppButton class="agent-send-button" type="submit" icon size="sm" variant="primary" aria-label="立即插话">
                <span class="i-mingcute-send-plane-line size-4" aria-hidden="true" />
              </AppButton>
            </AppTooltip>
          </template>
          <AppTooltip :text="agent.active.compacting ? '停止压缩' : '停止生成'">
            <AppButton
              type="button"
              icon
              size="sm"
              variant="ghost"
              :aria-label="agent.active.compacting ? '停止压缩' : '停止生成'"
              @click="agent.perform(() => getDesktopApi().agentHost.request('cancel', { id: agent.activeId! }))"
              ><span class="i-mingcute-stop-fill size-4" aria-hidden="true"
            /></AppButton>
          </AppTooltip>
        </template>
        <AppTooltip v-else text="发送">
          <AppButton
            class="agent-send-button"
            type="submit"
            icon
            size="sm"
            variant="primary"
            aria-label="发送"
            :disabled="!editable || !agent.draft.trim() || (!agent.active && !agent.selectedModel)"
          >
            <span class="i-mingcute-send-plane-line size-4" aria-hidden="true" />
          </AppButton>
        </AppTooltip>
      </div>
    </div>
    <div v-if="agent.active" class="agent-composer-meta agent-column">
      <span v-if="agent.active.compacting" role="status">正在压缩…</span>
      <SessionUsage :key="agent.active.id" :usage="agent.active.usage" />
    </div>
  </AppForm>
</template>
