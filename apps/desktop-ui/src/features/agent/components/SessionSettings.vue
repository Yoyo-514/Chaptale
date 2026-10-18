<script setup lang="ts">
import { computed } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { useSettingsStore } from '@/features/settings';
import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi } from '@/utils/desktop-api';

import { useAgentStore } from '../store';
import InstructionsEditor from './InstructionsEditor.vue';

const agent = useAgentStore();
const workspace = useWorkspaceStore();
const settings = useSettingsStore();
const editable = computed(() => agent.connected && !agent.active?.readonly && !agent.active?.running);
/** 作品显示名字；其他目录只显示最后一段，完整路径放在悬停提示里。 */
function workName(cwd: string) {
  if (cwd === agent.state?.cwd) return '独立会话';
  if (cwd === workspace.rootPath) return workspace.displayName ?? cwd;
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd;
}
</script>

<template>
  <section class="agent-subpage agent-session-settings">
    <template v-if="!agent.active">
      <div class="agent-form agent-settings-scroll">
        <p class="agent-field-help">这些设置用于接下来开始的会话。</p>
        <label
          >所属作品<AppSelect
            :model-value="agent.composeCwd ?? 'independent'"
            aria-label="所属作品"
            @update:model-value="agent.composeCwd = $event === 'independent' ? undefined : $event"
          >
            <AppSelectItem value="independent">独立会话</AppSelectItem>
            <AppSelectItem v-if="workspace.rootPath" :value="workspace.rootPath">{{
              workspace.displayName
            }}</AppSelectItem>
            <AppSelectItem
              v-if="agent.composeCwd && agent.composeCwd !== workspace.rootPath"
              :value="agent.composeCwd"
              >{{ workName(agent.composeCwd) }}</AppSelectItem
            >
          </AppSelect></label
        >
        <label
          >使用的指令<AppSelect
            :model-value="agent.composeInstructions ? `preset:${agent.composeInstructions}` : 'default'"
            aria-label="使用的指令"
            @update:model-value="agent.composeInstructions = $event === 'default' ? undefined : $event.slice(7)"
            ><AppSelectItem value="default">新会话默认指令</AppSelectItem>
            <AppSelectItem
              v-for="item in agent.state?.settings.namedInstructions"
              :key="item.name"
              :value="`preset:${item.name}`"
              >{{ item.name }}</AppSelectItem
            >
          </AppSelect></label
        >
        <AppButton type="button" size="sm" variant="ghost" class="self-start" @click="settings.openPanel('prompt')"
          >管理默认指令与命名指令</AppButton
        >
      </div>
    </template>
    <template v-else>
      <dl class="agent-session-facts">
        <dt>所属</dt>
        <dd :title="agent.active.cwd">{{ workName(agent.active.cwd) }}</dd>
      </dl>
      <p class="agent-field-help agent-session-scope">指令修改只作用于当前会话。</p>
      <InstructionsEditor
        :entries="agent.active.instructions"
        :disabled="!editable"
        layout="stacked"
        label="保存当前会话指令"
        @save="
          entries =>
            agent.perform(() => getDesktopApi().agentHost.request('instructions', { id: agent.activeId!, entries }))
        "
      />
    </template>
  </section>
</template>
