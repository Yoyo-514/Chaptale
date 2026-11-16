<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue';

import type { ApprovalScope, EditorContext } from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { AppAlertDialog } from '@/components/AppDialog';
import { AppDropdownMenu, AppDropdownMenuItem } from '@/components/AppDropdownMenu';
import { AppInput } from '@/components/AppInput';
import { AppTooltip } from '@/components/AppTooltip';
import { useReviewStore } from '@/features/editor';
import { useSettingsStore } from '@/features/settings';
import { useWorkbenchStore } from '@/features/workbench';
import { getDesktopApi } from '@/utils/desktop-api';

import MessageComposer from './components/MessageComposer.vue';
import MessageList from './components/MessageList.vue';
import PendingReviewCard from './components/PendingReviewCard.vue';
import SessionHistory from './components/SessionHistory.vue';
import SessionSettings from './components/SessionSettings.vue';
import { type SessionEntry, useAgentStore } from './store';

const agent = useAgentStore();
const navigation = useWorkbenchStore();
const settings = useSettingsStore();
const review = useReviewStore();
const body = ref<HTMLElement>();
const positions = new Map<string, { top: number; follow: boolean }>();
const following = ref(true);
const approvals = computed(() => agent.state?.approvals.filter(item => item.sessionId === agent.activeId) ?? []);
const error = computed(() => agent.error || agent.active?.error);
const title = computed(() => (agent.active ? agent.title(agent.active) : '新会话'));
/** 标题下拉列出当前范围最近的会话，完整列表在「全部历史」子页。 */
const renaming = ref(false);
const nameDraft = ref('');
const nameInput = ref<{ $el: HTMLElement }>();
const renamable = computed(() => agent.connected && Boolean(agent.active) && !agent.active?.readonly);
/** 重命名从更多菜单进入；菜单关闭时由标题输入框接管焦点，取代默认的触发器焦点恢复。 */
function startRename() {
  if (!renamable.value) return;
  nameDraft.value = title.value;
  renaming.value = true;
}
function focusRename(event: Event) {
  if (!renaming.value) return;
  event.preventDefault();
  nameInput.value?.$el.querySelector('input')?.select();
}
async function finishRename(save: boolean) {
  if (!renaming.value) return;
  renaming.value = false;
  const name = nameDraft.value.trim();
  if (save && name && name !== title.value) await agent.rename(agent.activeId!, name);
}
watch(
  () => navigation.auxiliaryOpen || navigation.agentInMain,
  visible => {
    if (visible) void agent.connect();
  },
  { immediate: true }
);
// 作者正在查看的会话：交付摘要随之刷新，新写入的待审修改可切到前台。
watch(
  () =>
    (navigation.auxiliaryOpen || navigation.agentInMain) && navigation.agentView === 'chat'
      ? (agent.active?.sessionId ?? null)
      : null,
  id => {
    review.viewingSessionId = id;
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
// 作者刚发出或入队消息时总是滚到底部，让乐观显示或排队中的消息可见。
watch(
  () => agent.activeOutgoing.length + (agent.active?.queued?.length ?? 0),
  async (count, was) => {
    if (count <= was) return;
    following.value = true;
    await nextTick();
    body.value?.scrollTo({ top: body.value.scrollHeight });
  }
);
function create() {
  agent.newDraft();
  navigation.agentView = 'chat';
}
function createIndependent() {
  void agent.newDraft(true);
  navigation.agentView = 'chat';
}
function select(entry: SessionEntry) {
  void agent.view(entry);
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
function approve(id: string, allow: boolean, scope?: ApprovalScope) {
  void agent.perform(() => getDesktopApi().agentHost.request('approve', { id, allow, ...(scope && { scope }) }));
}

type PendingBranchAction =
  | { kind: 'edit'; entryId: string; text: string; editorContext?: EditorContext }
  | { kind: 'switch'; leafId: string };
const branchConfirmOpen = ref(false);
const pendingBranchAction = shallowRef<PendingBranchAction>();
const pendingReviewCount = computed(() => {
  const sessionId = agent.active?.sessionId;
  if (!sessionId) return 0;
  return (review.summaries[sessionId] ?? []).reduce((sum, item) => sum + item.count, 0);
});
function requestEditMessage(payload: { entryId: string; text: string; editorContext?: EditorContext }) {
  if (pendingReviewCount.value > 0) {
    pendingBranchAction.value = { kind: 'edit', ...payload };
    branchConfirmOpen.value = true;
    return;
  }
  void agent.editMessage(payload.entryId, payload.text, payload.editorContext);
}
function requestSwitchBranch(leafId: string) {
  if (pendingReviewCount.value > 0) {
    pendingBranchAction.value = { kind: 'switch', leafId };
    branchConfirmOpen.value = true;
    return;
  }
  void agent.switchBranch(leafId);
}
function confirmBranchAction() {
  const action = pendingBranchAction.value;
  if (!action) return;
  if (action.kind === 'edit') void agent.editMessage(action.entryId, action.text, action.editorContext, true);
  else void agent.switchBranch(action.leafId, true);
}
</script>

<template>
  <section class="agent-panel" aria-label="会话视图">
    <header class="agent-header">
      <template v-if="navigation.agentView !== 'chat'">
        <AppButton
          size="xs"
          variant="ghost"
          class="agent-back"
          aria-label="返回会话"
          @click="navigation.agentView = 'chat'"
        >
          <span class="i-mingcute-left-line size-4" aria-hidden="true" />
        </AppButton>
        <h2 class="agent-header-subtitle">{{ navigation.agentView === 'history' ? '全部历史' : '会话设置' }}</h2>
      </template>
      <template v-else>
        <AppInput
          v-if="renaming"
          ref="nameInput"
          v-model="nameDraft"
          class="agent-title-input"
          aria-label="会话名称"
          maxlength="80"
          @keydown.enter.prevent="finishRename(true)"
          @keydown.esc.prevent="finishRename(false)"
          @blur="finishRename(true)"
        />
        <AppDropdownMenu v-else align="start" content-size="md" :disabled="!agent.connected">
          <template #trigger>
            <button type="button" class="agent-title-button" aria-label="切换会话" :disabled="!agent.connected">
              <span class="agent-title-text">{{ title }}</span>
              <span class="i-mingcute-down-line size-3.5 shrink-0" aria-hidden="true" />
            </button>
          </template>
          <p v-if="agent.recent.length" class="agent-menu-heading">最近</p>
          <AppDropdownMenuItem
            v-for="entry in agent.recent"
            :key="entry.key"
            density="sm"
            item-class="agent-menu-item"
            :active="Boolean(entry.live) && entry.live?.id === agent.activeId"
            :aria-label="`查看${entry.title}`"
            @select="select(entry)"
          >
            <span class="min-w-0 flex-1 truncate">{{ entry.title }}</span>
            <span v-if="entry.live?.running" class="agent-menu-meta">{{
              entry.live.compacting ? '压缩中' : '生成中'
            }}</span>
          </AppDropdownMenuItem>
          <hr v-if="agent.recent.length" class="agent-menu-separator" />
          <AppDropdownMenuItem density="sm" item-class="agent-menu-item" @select="navigation.agentView = 'history'">
            <span class="i-mingcute-history-line size-4 shrink-0" aria-hidden="true" />全部历史
          </AppDropdownMenuItem>
        </AppDropdownMenu>
        <span class="flex-1" />
        <AppTooltip text="新建会话">
          <AppButton
            icon
            size="sm"
            variant="ghost"
            aria-label="新建会话"
            :disabled="!agent.connected || agent.creating"
            @click="create"
          >
            <span class="i-mingcute-add-line size-4" aria-hidden="true" />
          </AppButton>
        </AppTooltip>
      </template>
      <AppDropdownMenu align="end" content-size="sm" @close-auto-focus="focusRename">
        <template #trigger>
          <AppButton icon size="sm" variant="ghost" aria-label="更多会话操作">
            <span class="i-mingcute-more-1-line size-4" aria-hidden="true" />
          </AppButton>
        </template>
        <AppDropdownMenuItem
          density="sm"
          item-class="agent-menu-item"
          :disabled="!agent.connected || agent.creating"
          @select="createIndependent"
        >
          <span class="i-mingcute-add-line size-4 shrink-0" aria-hidden="true" />新建独立会话
        </AppDropdownMenuItem>
        <AppDropdownMenuItem density="sm" item-class="agent-menu-item" :disabled="!renamable" @select="startRename">
          <span class="i-mingcute-edit-line size-4 shrink-0" aria-hidden="true" />重命名
        </AppDropdownMenuItem>
        <AppDropdownMenuItem
          density="sm"
          item-class="agent-menu-item"
          :disabled="!agent.connected || agent.creating"
          @select="navigation.agentView = 'settings'"
        >
          <span class="i-mingcute-settings-6-line size-4 shrink-0" aria-hidden="true" />会话设置
        </AppDropdownMenuItem>
        <AppDropdownMenuItem
          density="sm"
          item-class="agent-menu-item"
          :disabled="!agent.connected || !agent.active || !!agent.active.readonly || agent.active.running"
          @select="agent.perform(() => getDesktopApi().agentHost.request('compact', { id: agent.activeId! }))"
        >
          <span class="i-mingcute-minimize-line size-4 shrink-0" aria-hidden="true" />压缩对话
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
          <div
            v-if="!agent.active?.messages.length && !agent.activeOutgoing.length && !agent.active?.queued?.length"
            class="agent-start"
          >
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
          <MessageList
            v-if="agent.active"
            :session="agent.active"
            :approvals="approvals"
            :outgoing="agent.activeOutgoing"
            @approve="approve"
            @retry="agent.retryOutgoing"
            @discard="agent.discardOutgoing"
            @recall-queued="agent.recallQueued"
            @edit-message="requestEditMessage"
            @switch-branch="requestSwitchBranch"
          />
        </div>
      </div>
      <PendingReviewCard v-if="agent.active" />
      <MessageComposer />
      <AppAlertDialog
        v-model:open="branchConfirmOpen"
        title="撤回待审修改并继续？"
        :description="`当前分支还有 ${pendingReviewCount} 处待接受修改尚未处理，继续将一并拒绝这 ${pendingReviewCount} 处修改。`"
        confirm-label="拒绝并继续"
        @confirm="confirmBranchAction"
      />
    </template>
    <p v-if="error" role="alert" class="agent-error agent-panel-error">{{ error }}</p>
  </section>
</template>
