<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppDropdownMenu, AppDropdownMenuItem } from '@/components/AppDropdownMenu';
import { AppTooltip } from '@/components/AppTooltip';
import { useSettingsStore } from '@/features/settings';
import { useWorkbenchStore } from '@/features/workbench';
import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi } from '@/utils/desktop-api';

import MessageComposer from './components/MessageComposer.vue';
import MessageList from './components/MessageList.vue';
import SessionHistory from './components/SessionHistory.vue';
import SessionSettings from './components/SessionSettings.vue';
import { useAgentStore } from './store';

const agent = useAgentStore();
const navigation = useWorkbenchStore();
const workspace = useWorkspaceStore();
const settings = useSettingsStore();
const body = ref<HTMLElement>();
const positions = new Map<string, { top: number; follow: boolean }>();
const following = ref(true);
const approvals = computed(() => agent.state?.approvals.filter(item => item.sessionId === agent.activeId) ?? []);
const error = computed(() => agent.error || agent.active?.error);
const title = computed(() => (agent.active ? agent.title(agent.active) : '新会话'));
/** 标题下拉只列已打开的会话，完整历史在「全部历史」子页。 */
const opened = computed(() => agent.state?.sessions ?? []);
watch(
  () => navigation.auxiliaryOpen || navigation.agentInMain,
  visible => {
    if (visible) void agent.connect();
  },
  { immediate: true }
);
function trackScroll() {
  const element = body.value!;
  following.value = element.scrollHeight - element.scrollTop - element.clientHeight < 2;
  positions.set(agent.activeId ?? 'new', { top: element.scrollTop, follow: following.value });
}
watch(
  () => [agent.activeId, navigation.agentView],
  async () => {
    await nextTick();
    const position = positions.get(agent.activeId ?? 'new');
    following.value = position?.follow ?? true;
    body.value?.scrollTo({ top: position ? position.top : body.value.scrollHeight });
  }
);
watch(
  () => [
    agent.active?.messages.length,
    agent.active?.messages.at(-1)?.text,
    agent.active?.messages.at(-1)?.thinking,
    approvals.value.length
  ],
  async () => {
    if (!following.value) return;
    await nextTick();
    body.value?.scrollTo({ top: body.value.scrollHeight });
  }
);
function create() {
  agent.newDraft(workspace.rootPath ?? undefined);
  navigation.agentView = 'chat';
}
function select(id: string) {
  agent.select(id);
  navigation.agentView = 'chat';
}
function closeView() {
  navigation.agentInMain = false;
  navigation.auxiliaryOpen = false;
}
function move() {
  navigation.agentInMain = !navigation.agentInMain;
  navigation.auxiliaryOpen = true;
}
function approve(id: string, allow: boolean) {
  void agent.perform(() => getDesktopApi().agentHost.request('approve', { id, allow }));
}
</script>

<template>
  <section class="agent-panel" aria-label="会话视图">
    <header class="agent-header">
      <template v-if="navigation.agentView !== 'chat'">
        <AppButton size="sm" variant="ghost" class="agent-back" @click="navigation.agentView = 'chat'">
          <span class="i-mingcute-left-line size-4" aria-hidden="true" />返回会话
        </AppButton>
        <h2 class="agent-header-subtitle">{{ navigation.agentView === 'history' ? '全部历史' : '会话设置' }}</h2>
      </template>
      <template v-else>
        <AppDropdownMenu align="start" content-size="md" :disabled="!agent.connected">
          <template #trigger>
            <button type="button" class="agent-title-button" aria-label="切换会话" :disabled="!agent.connected">
              <span class="agent-title-text">{{ title }}</span>
              <span class="i-mingcute-down-line size-3.5 shrink-0" aria-hidden="true" />
            </button>
          </template>
          <p v-if="opened.length" class="agent-menu-heading">已打开</p>
          <AppDropdownMenuItem
            v-for="session in opened"
            :key="session.id"
            density="sm"
            item-class="agent-menu-item"
            :active="session.id === agent.activeId"
            :aria-label="`查看${agent.title(session)}`"
            @select="select(session.id)"
          >
            <span class="min-w-0 flex-1 truncate">{{ agent.title(session) }}</span>
            <span v-if="session.running" class="agent-menu-meta">生成中</span>
            <span v-else-if="session.readonly" class="agent-menu-meta">只读</span>
          </AppDropdownMenuItem>
          <hr v-if="opened.length" class="agent-menu-separator" />
          <AppDropdownMenuItem density="sm" item-class="agent-menu-item" @select="navigation.agentView = 'history'">
            <span class="i-mingcute-history-line size-4 shrink-0" aria-hidden="true" />全部历史
          </AppDropdownMenuItem>
        </AppDropdownMenu>
        <span class="flex-1" />
        <AppTooltip text="新建会话">
          <AppButton icon size="sm" variant="ghost" aria-label="新建会话" :disabled="!agent.connected" @click="create">
            <span class="i-mingcute-add-line size-4" aria-hidden="true" />
          </AppButton>
        </AppTooltip>
      </template>
      <AppDropdownMenu align="end" content-size="sm">
        <template #trigger>
          <AppButton icon size="sm" variant="ghost" aria-label="更多会话操作">
            <span class="i-mingcute-more-1-line size-4" aria-hidden="true" />
          </AppButton>
        </template>
        <AppDropdownMenuItem
          density="sm"
          item-class="agent-menu-item"
          :disabled="!agent.connected"
          @select="navigation.agentView = 'settings'"
        >
          <span class="i-mingcute-settings-6-line size-4 shrink-0" aria-hidden="true" />会话设置
        </AppDropdownMenuItem>
        <AppDropdownMenuItem density="sm" item-class="agent-menu-item" @select="move">
          <span
            :class="navigation.agentInMain ? 'i-mingcute-layout-right-line' : 'i-mingcute-fullscreen-line'"
            class="size-4 shrink-0"
            aria-hidden="true"
          />{{ navigation.agentInMain ? '移到协作栏' : '移到主区' }}
        </AppDropdownMenuItem>
        <hr class="agent-menu-separator" />
        <AppDropdownMenuItem density="sm" item-class="agent-menu-item" @select="closeView">
          <span class="i-mingcute-close-line size-4 shrink-0" aria-hidden="true" />关闭会话视图
        </AppDropdownMenuItem>
      </AppDropdownMenu>
    </header>
    <div v-if="!agent.connected" class="agent-body agent-start">
      <p>{{ agent.connecting ? '正在连接会话服务…' : '会话服务已断开' }}</p>
      <AppButton v-if="!agent.connecting" variant="ghost" @click="agent.connect">重新连接</AppButton>
    </div>
    <SessionHistory v-else-if="navigation.agentView === 'history'" @select="navigation.agentView = 'chat'" />
    <SessionSettings v-else-if="navigation.agentView === 'settings'" />
    <template v-else>
      <div ref="body" class="agent-body" @scroll="trackScroll">
        <div class="agent-column">
          <p v-if="agent.active?.readonly" role="status" class="agent-readonly">
            <span class="i-mingcute-lock-line size-4 shrink-0" aria-hidden="true" />
            <span>只读历史：{{ agent.active.readonly.message }}</span>
          </p>
          <div v-if="!agent.active?.messages.length" class="agent-start">
            <h3>从一个想法开始</h3>
            <p>讨论情节、推敲人物，或继续眼前这一章。</p>
            <AppButton
              v-if="agent.connected && !agent.state?.models.length"
              variant="primary"
              size="sm"
              @click="settings.openPanel('llm')"
              >配置模型</AppButton
            >
          </div>
          <MessageList v-if="agent.active" :session="agent.active" :approvals="approvals" @approve="approve" />
        </div>
      </div>
      <MessageComposer />
    </template>
    <p v-if="error" role="alert" class="agent-error agent-panel-error">{{ error }}</p>
  </section>
</template>
