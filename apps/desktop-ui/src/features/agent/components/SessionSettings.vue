<script setup lang="ts">
import { computed } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { useCreationStore } from '@/features/creation';
import { useSettingsStore } from '@/features/settings';
import { getDesktopApi } from '@/utils/desktop-api';

import { useAgentStore } from '../store';
import InstructionsEditor from './InstructionsEditor.vue';

const agent = useAgentStore();
const settings = useSettingsStore();
const creation = useCreationStore();
const editable = computed(
  () => agent.connected && !agent.creating && !agent.active?.readonly && !agent.active?.running
);
/** 归属作品决定会话的工作目录：作品文件目录，未归属时为空目录。 */
const workTitle = computed(() => {
  const workId = agent.owner(agent.active?.sessionId ?? null);
  if (workId === null) return '未归属作品';
  return creation.works.find(work => work.id === workId)?.title ?? '已删除的作品';
});
const sessionPermissions = computed(() => {
  const sessionId = agent.active?.sessionId;
  if (!sessionId || !agent.state) return [];
  return agent.state.settings.toolPermissions.filter(
    item => item.scope.kind === 'session' && item.scope.sessionId === sessionId
  );
});
function revokePermission(id: string) {
  void agent.perform(() => getDesktopApi().agentHost.request('revokeToolPermission', { id }));
}
</script>

<template>
  <section class="agent-subpage agent-session-settings">
    <template v-if="!agent.active">
      <div class="agent-form agent-settings-scroll">
        <p class="agent-field-help">这些设置用于接下来开始的会话。</p>
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
        <dt>所属作品</dt>
        <dd>{{ workTitle }}</dd>
        <dt>本会话授权</dt>
        <dd>{{ sessionPermissions.length ? `已允许 ${sessionPermissions.length} 处` : '未保存授权' }}</dd>
      </dl>
      <ul v-if="sessionPermissions.length" class="agent-session-permissions" aria-label="本会话已保存的授权">
        <li v-for="item in sessionPermissions" :key="item.id" class="agent-session-permission-item">
          <div class="agent-session-permission-copy">
            <template v-if="item.capability === 'fs_read'">
              <span>{{ item.pathKind === 'file' ? '读取文件' : '读取目录' }}</span>
              <code>{{ item.path }}</code>
            </template>
            <template v-else>
              <span>{{ item.toolName ? '调用 MCP 工具' : '调用 MCP 服务的全部工具' }}</span>
              <code>{{ item.toolName ? `${item.serverName} / ${item.toolName}` : item.serverName }}</code>
            </template>
          </div>
          <AppButton
            type="button"
            size="xs"
            variant="ghost"
            :disabled="!agent.connected"
            @click="revokePermission(item.id)"
            >撤销</AppButton
          >
        </li>
      </ul>
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

<style lang="scss">
.agent-session-settings {
  display: flex;
  height: 100%;
  min-height: 0;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
}
.agent-session-facts {
  display: grid;
  flex-shrink: 0;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 12px;
  margin: 0;
  padding: 14px 16px 4px;
  font-size: var(--ui-font-size);
}
.agent-session-facts dt {
  color: var(--muted-foreground);
}
.agent-session-facts dd {
  overflow: hidden;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-session-scope {
  flex-shrink: 0;
  margin: 0;
  padding: 0 16px 10px;
}
.agent-session-permissions {
  display: flex;
  max-height: 8.5rem;
  flex-shrink: 0;
  flex-direction: column;
  gap: 6px;
  overflow: auto;
  margin: 4px 16px 8px;
  padding: 0;
  list-style: none;
}
.agent-session-permission-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control);
  background: var(--surface-acrylic-subtle);
}
.agent-session-permission-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  font-size: var(--ui-caption-size);
}
.agent-session-permission-copy > span {
  color: var(--muted-foreground);
}
.agent-session-permission-copy > code {
  color: var(--foreground);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  overflow-wrap: anywhere;
}
.agent-session-settings > .agent-settings-scroll {
  padding: 16px;
  overflow: auto;
}
</style>
