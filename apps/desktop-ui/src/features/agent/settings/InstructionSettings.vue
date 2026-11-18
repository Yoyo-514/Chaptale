<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import type { AgentInstructions, EditMode } from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { AppAlertDialog } from '@/components/AppDialog';
import { AppInput } from '@/components/AppInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { SettingsSectionView as SettingsSection } from '@/features/settings';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import InstructionsEditor from '../components/InstructionsEditor.vue';
import { useAgentStore } from '../store';

const agent = useAgentStore();
const library = ref(false);
const creating = ref(false);
const target = ref<string>();
const name = ref('');
const saving = ref(false);
const saved = ref(false);
const error = ref('');
const entries = computed(() => {
  if (!agent.state) return [];
  if (!library.value || creating.value) return agent.state.settings.defaultInstructions;
  return agent.state.settings.namedInstructions.find(item => item.name === target.value)?.entries ?? [];
});
onMounted(() => {
  void agent.connect();
});
async function operation(action: () => Promise<unknown>) {
  saving.value = true;
  saved.value = false;
  error.value = '';
  try {
    await action();
    saved.value = true;
    return true;
  } catch (cause) {
    error.value = toErrorMessage(cause);
    return false;
  } finally {
    saving.value = false;
  }
}
function openLibrary() {
  library.value = true;
  creating.value = false;
  target.value = agent.state!.settings.namedInstructions[0]?.name;
}
function create() {
  creating.value = true;
  name.value = '';
  saved.value = false;
}
async function save(next: AgentInstructions) {
  if (!library.value) {
    await operation(() => getDesktopApi().agentHost.request('defaultInstructions', { entries: next }));
    return;
  }
  const selectedName = creating.value ? name.value.trim() : target.value!;
  if (
    await operation(() => getDesktopApi().agentHost.request('namedInstructions', { name: selectedName, entries: next }))
  ) {
    target.value = selectedName;
    creating.value = false;
  }
}
function mode(value: string) {
  void operation(() => getDesktopApi().agentHost.request('defaultMode', { mode: value as EditMode }));
}
async function remove() {
  const selected = target.value!;
  if (await operation(() => getDesktopApi().agentHost.request('deleteNamedInstructions', { name: selected })))
    openLibrary();
}
</script>

<template>
  <SettingsSection
    title="写作指令"
    title-id="settings-instructions-title"
    description="约定助手如何协作。每个会话保存自己的指令。"
    flush
  >
    <template v-if="agent.state">
      <div class="agent-settings-toolbar">
        <div class="agent-subnav" aria-label="指令范围">
          <AppButton
            type="button"
            variant="ghost"
            :selected="!library"
            :aria-pressed="!library"
            @click="
              library = false;
              creating = false;
              saved = false;
            "
            >新会话默认</AppButton
          ><AppButton type="button" variant="ghost" :selected="library" :aria-pressed="library" @click="openLibrary"
            >保存的指令</AppButton
          >
        </div>
        <label v-if="!library" class="agent-inline-field"
          >默认模式<AppSelect
            :model-value="agent.state.settings.defaultMode"
            aria-label="新会话默认模式"
            :disabled="saving"
            @update:model-value="mode"
            ><AppSelectItem value="discuss">讨论</AppSelectItem><AppSelectItem value="review">审阅</AppSelectItem
            ><AppSelectItem value="direct">直接修改</AppSelectItem></AppSelect
          ></label
        >
      </div>
      <div v-if="library" class="instruction-library-toolbar agent-form">
        <template v-if="creating"
          ><label>这套指令的名称<AppInput v-model="name" placeholder="例如：对白润色" /></label
          ><AppButton type="button" variant="ghost" @click="openLibrary">取消新建</AppButton></template
        >
        <template v-else
          ><AppSelect
            v-model="target"
            aria-label="已保存的指令"
            placeholder="选择一套指令"
            @update:model-value="saved = false"
            ><AppSelectItem
              v-for="item in agent.state.settings.namedInstructions"
              :key="item.name"
              :value="item.name"
              >{{ item.name }}</AppSelectItem
            ></AppSelect
          ><AppButton type="button" variant="ghost" @click="create">新建一套</AppButton
          ><AppAlertDialog
            v-if="target"
            :title="`删除“${target}”？`"
            description="已经选用它的会话不受影响。"
            confirm-label="删除"
            @confirm="remove"
            ><template #trigger
              ><AppButton type="button" variant="ghost" :disabled="saving">删除这套</AppButton></template
            ></AppAlertDialog
          ></template
        >
      </div>
      <p class="instruction-scope">{{ library ? '在新会话的设置里选用。' : '保存后用于之后新建的会话。' }}</p>
      <InstructionsEditor
        v-if="!library || creating || target"
        :key="!library ? 'default' : creating ? 'creating' : `named:${target}`"
        :entries="entries"
        :disabled="saving || !agent.connected || (creating && !name.trim())"
        :label="library ? '保存这套指令' : '保存新会话默认指令'"
        @save="save"
      />
      <div v-else class="agent-settings-scroll agent-start">
        <p>保存一套常用要求，新会话可以直接选用。</p>
        <AppButton variant="ghost" @click="create">新建一套指令</AppButton>
      </div>
      <p v-if="saved" role="status" class="agent-settings-status">已保存。</p>
    </template>
    <p v-else class="agent-empty-small">{{ agent.connecting ? '正在读取指令…' : agent.error }}</p>
    <p v-if="error" role="alert" class="agent-error agent-settings-status">{{ error }}</p>
  </SettingsSection>
</template>

<style lang="scss">
.agent-settings-toolbar {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px 12px;
}
.agent-subnav {
  display: flex;
  gap: 4px;
}
.agent-inline-field {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.agent-inline-field > .app-select-trigger {
  width: 6rem;
}
.agent-settings-status {
  flex-shrink: 0;
  margin: 0;
  padding: 6px 16px;
  font-size: var(--ui-caption-size);
}
.instruction-scope {
  flex-shrink: 0;
  margin: 0;
  padding: 0 16px 12px;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  line-height: 1.6;
}
.instruction-library-toolbar {
  flex-shrink: 0;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-end;
  padding: 0 16px 12px;
}
.instruction-library-toolbar > .app-select-trigger,
.instruction-library-toolbar > label {
  min-width: 10rem;
  flex: 1;
}
</style>
