<script setup lang="ts">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui';
import { computed, defineAsyncComponent, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppContextMenu, type AppContextMenuItem } from '@/components/AppContextMenu';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppTooltip } from '@/components/AppTooltip';
import { useWorkspaceStore, useWorkspaceActions } from '@/features/workspace';
import { APP_ICON_URL } from '@/utils/app-icon';
import { getDesktopApi, hasDesktopApi } from '@/utils/desktop-api';

import { useEditorStore } from '../store';
import NewChapterDialog from './NewChapterDialog.vue';
import UnsavedDocumentsDialog from './UnsavedDocumentsDialog.vue';

const DocumentView = defineAsyncComponent(() => import('./DocumentView.vue'));
const ExternalChangeDialog = defineAsyncComponent(() => import('./ExternalChangeDialog.vue'));

const editor = useEditorStore();
const workspace = useWorkspaceStore();
const actions = useWorkspaceActions();
const contextTabId = ref('');
const tabMenu = computed<AppContextMenuItem[]>(() => {
  const tab = editor.tabs.find(item => item.id === contextTabId.value);
  const index = editor.tabs.findIndex(item => item.id === contextTabId.value);
  return [
    { id: 'close', label: '关闭', shortcut: 'Ctrl+W', icon: 'i-mingcute-close-line' },
    { id: 'close-others', label: '关闭其他标签', disabled: editor.tabs.length < 2 },
    { id: 'close-right', label: '关闭右侧标签', disabled: index >= editor.tabs.length - 1 },
    { id: 'close-saved', label: '关闭已保存标签', disabled: !editor.tabs.some(item => !item.dirty && !item.saving) },
    { id: 'close-all', label: '关闭全部标签' },
    { id: 'save', label: '保存', shortcut: 'Ctrl+S', disabled: !tab?.dirty, separatorBefore: true },
    { id: 'save-all', label: '全部保存', disabled: !editor.hasUnsaved },
    { id: 'copy-path', label: '复制相对路径', separatorBefore: true },
    { id: 'reveal', label: '在系统文件管理器中显示' },
    { id: 'rename', label: '重命名…' },
    { id: 'agent', label: '与 Agent 讨论此文件', separatorBefore: true, icon: 'i-mingcute-chat-3-line' }
  ];
});
async function selectTabMenu(id: string) {
  const tab = editor.tabs.find(item => item.id === contextTabId.value);
  if (!tab) return;
  const index = editor.tabs.indexOf(tab);
  if (id === 'close') await closeTab(tab.id);
  else if (id.startsWith('close-')) {
    const candidates = editor.tabs.filter(
      (item, i) =>
        id === 'close-all' ||
        (id === 'close-others' && item.id !== tab.id) ||
        (id === 'close-right' && i > index) ||
        (id === 'close-saved' && !item.dirty && !item.saving)
    );
    await editor.closeTabs(candidates.map(item => item.id));
  } else if (id === 'save') await editor.saveDocument(tab.id);
  else if (id === 'save-all') await editor.saveAll();
  else if (id === 'copy-path') await actions.copyPath(tab.path);
  else if (id === 'reveal') await actions.reveal(tab.path);
  else if (id === 'rename') await actions.prepare('rename', tab.path);
  else if (id === 'agent') actions.askAgent(tab.path);
}
let unsubscribeClose: (() => void) | undefined;
const tabList = ref<HTMLElement | null>(null);
const duplicateTitles = computed(() => {
  const counts = new Map<string, number>();
  for (const tab of editor.tabs) counts.set(tab.title, (counts.get(tab.title) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([title]) => title));
});

async function closeTab(id: string) {
  const focusedInside = tabList.value?.contains(document.activeElement);
  await editor.closeTab(id);
  if (focusedInside) {
    await nextTick();
    tabList.value?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }
}

function scrollTabs(event: WheelEvent) {
  if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
  const viewport = tabList.value?.querySelector<HTMLElement>('[data-slot="app-scroll-area-viewport"]');
  if (!viewport || viewport.scrollWidth <= viewport.clientWidth) return;
  const previous = viewport.scrollLeft;
  viewport.scrollLeft += event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 24 : 1);
  if (viewport.scrollLeft !== previous) event.preventDefault();
}

function handleKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (event.shiftKey) void editor.saveAll();
    else void editor.saveDocument();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'w' && editor.activeId) {
    event.preventDefault();
    event.stopPropagation();
    void closeTab(editor.activeId);
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('beforeunload', editor.handleBeforeUnload);
  if (hasDesktopApi())
    unsubscribeClose = getDesktopApi().windowControl.onCloseRequested?.(() => {
      void editor.requestWindowClose();
    });
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('beforeunload', editor.handleBeforeUnload);
  unsubscribeClose?.();
});

watch(
  () => editor.activeId,
  async () => {
    await nextTick();
    tabList.value
      ?.querySelector('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
);
</script>

<template>
  <div v-if="editor.recoveries.length || editor.recoveryError" class="editor-recoveries">
    <p v-if="editor.recoveryError" role="alert">{{ editor.recoveryError }}</p>
    <details v-if="editor.recoveries.length" open>
      <summary>上次未保存的草稿（{{ editor.recoveries.length }}）</summary>
      <div v-for="draft in editor.recoveries" :key="draft.relativePath" class="editor-recovery-row">
        <span :title="draft.relativePath">{{ draft.relativePath }}</span>
        <AppButton size="xs" @click="editor.restoreRecovery(draft.relativePath)">恢复</AppButton>
        <AppButton size="xs" variant="ghost" @click="editor.discardRecovery(draft.relativePath)">放弃</AppButton>
      </div>
    </details>
  </div>
  <TabsRoot
    :model-value="editor.activeId || 'welcome'"
    class="editor-group"
    @update:model-value="value => editor.selectTab(String(value))"
  >
    <div ref="tabList" class="editor-tabs-scroll" @wheel="scrollTabs">
      <AppScrollArea orientation="horizontal" class="editor-tabs-area" viewport-class="editor-tabs-viewport">
        <TabsList class="editor-tabs" aria-label="编辑器标签">
          <TabsTrigger v-if="!editor.tabs.length" value="welcome" class="editor-tab">欢迎</TabsTrigger>
          <AppContextMenu
            v-for="tab in editor.tabs"
            :key="tab.id"
            :items="tabMenu"
            @prepare="contextTabId = tab.id"
            @select="selectTabMenu"
          >
            <div
              class="editor-tab-shell"
              :class="{ 'is-active': tab.id === editor.activeId }"
              @auxclick.middle.prevent="closeTab(tab.id)"
            >
              <TabsTrigger
                :value="tab.id"
                class="editor-tab"
                :aria-label="tab.path"
                :title="tab.path"
                @keydown.delete.prevent="closeTab(tab.id)"
              >
                <span
                  class="size-3.5 shrink-0"
                  :class="tab.status === 'error' ? 'i-mingcute-warning-line' : 'i-mingcute-file-line'"
                  aria-hidden="true"
                />
                <span class="editor-tab-title">{{ tab.title }}</span>
                <span v-if="tab.dirty" class="editor-dirty" aria-label="未保存" />
                <span v-if="duplicateTitles.has(tab.title)" class="editor-tab-parent">{{
                  tab.path.split('/').slice(0, -1).join('/') || '/'
                }}</span>
              </TabsTrigger>
              <AppTooltip :text="`关闭 ${tab.path}`" side="bottom">
                <AppButton
                  icon
                  size="xs"
                  variant="ghost"
                  class="editor-tab-close"
                  :aria-label="`关闭 ${tab.path}`"
                  :tabindex="tab.id === editor.activeId ? 0 : -1"
                  @click.stop="closeTab(tab.id)"
                >
                  <span class="i-mingcute-close-line size-3" aria-hidden="true" />
                </AppButton>
              </AppTooltip>
            </div>
          </AppContextMenu>
        </TabsList>
      </AppScrollArea>
    </div>

    <TabsContent v-if="!editor.tabs.length" value="welcome" class="editor-welcome">
      <img :src="APP_ICON_URL" alt="" width="44" height="44" aria-hidden="true" />
      <h1>Chaptale</h1>
      <p>尚未打开文件</p>
      <div class="editor-state-actions">
        <AppButton variant="primary" @click="workspace.newWorkspaceOpen = true"
          ><span class="i-mingcute-book-2-line size-4" aria-hidden="true" />新建作品</AppButton
        >
        <AppButton @click="workspace.openWorkspace"
          ><span class="i-mingcute-folder-open-2-line size-4" aria-hidden="true" />打开作品</AppButton
        >
        <AppButton v-if="workspace.rootPath" @click="editor.newChapterOpen = true">新建章节</AppButton>
      </div>
    </TabsContent>
    <TabsContent v-for="tab in editor.tabs" :key="tab.id" :value="tab.id" class="editor-tab-content">
      <div v-if="tab.status === 'loading'" class="editor-state" role="status">
        <span class="i-mingcute-loading-line size-5 animate-spin" aria-hidden="true" />
        <p>正在读取文件…</p>
      </div>
      <div v-else-if="tab.error" class="editor-state" role="alert">
        <span class="i-mingcute-warning-line size-6" aria-hidden="true" />
        <h2>无法打开文件</h2>
        <p>{{ tab.error.message }}</p>
        <div class="editor-state-actions">
          <AppButton size="sm" @click="editor.reloadDocument(tab.id)">
            <span class="i-mingcute-refresh-3-line size-3.5" aria-hidden="true" />重新读取
          </AppButton>
          <AppButton
            v-if="tab.error.code === 'too-large' && !tab.allowLarge"
            size="sm"
            @click="editor.reloadDocument(tab.id, true)"
          >
            以大文件模式打开
          </AppButton>
        </div>
      </div>
      <DocumentView
        v-else-if="tab.document"
        :key="`${tab.id}:${tab.generation ?? 0}`"
        :document="tab.document"
        :readonly="tab.readonly"
        :buffer="editor.getBuffer(tab.id)"
        :dirty="tab.dirty"
        :saving="tab.saving"
        :save-error="tab.saveError"
        :recovery-error="tab.recoveryError"
        :notice="tab.notice"
        :conflict="Boolean(tab.external)"
        :command="editor.command"
        :view-state="tab.viewState"
        :search-request="editor.searchRequest"
        @reload="editor.reloadDocument(tab.id)"
        @remember-view="state => editor.rememberView(tab.id, state)"
        @change="buffer => editor.updateBuffer(tab.id, buffer)"
        @save="editor.saveDocument(tab.id)"
        @compare="editor.conflictId = tab.id"
      />
    </TabsContent>
  </TabsRoot>
  <UnsavedDocumentsDialog />
  <NewChapterDialog />
  <ExternalChangeDialog v-if="editor.conflictId" />
</template>

<style scoped lang="scss">
.editor-group {
  @apply flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden;
}
.editor-recoveries {
  @apply max-h-36 shrink-0 overflow-auto border-b p-2 text-xs;
  border-color: var(--border-subtle);
  background: var(--surface-muted);
}
.editor-recovery-row {
  @apply mt-2 flex items-center gap-2;
}
.editor-recovery-row > span {
  @apply min-w-0 flex-1 truncate;
}

.editor-tabs-scroll {
  @apply h-9 min-w-0 shrink-0 overflow-hidden border-b;

  border-color: var(--border-subtle);
  background: var(--surface-acrylic-subtle);
}

.editor-tabs-area {
  @apply h-full w-full;
}

.editor-tabs-area :deep(.editor-tabs-viewport > div) {
  height: 100%;
}

.editor-tabs {
  @apply flex h-full w-max min-w-full items-stretch;
}

.editor-tab-shell {
  @apply relative flex max-w-72 shrink-0 items-center border-r pr-1;

  border-color: var(--border-subtle);
  transition: none;
}

.editor-tab-shell.is-active {
  background: var(--mica-background);
}

.editor-tab-shell.is-active::before {
  @apply absolute inset-x-0 top-0 h-0.5;

  content: '';
  background: var(--primary-solid);
}

.editor-tab {
  @apply flex h-full min-w-0 items-center gap-2 border-0 bg-transparent px-3 outline-none;
  font-size: var(--ui-font-size);

  color: var(--muted-foreground);
  letter-spacing: 0;
}

.editor-tab[data-state='active'] {
  color: var(--foreground);
}

.editor-tab:focus-visible {
  outline: 1px solid var(--ring);
  outline-offset: -3px;
}

.editor-tab-title {
  @apply min-w-0 truncate;
}

.editor-dirty {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--foreground);
}

.editor-tab-parent {
  @apply max-w-24 truncate text-xs;

  color: var(--muted-foreground);
}

.editor-tab-close {
  @apply shrink-0;
}

.editor-tab-content {
  @apply min-h-0 min-w-0 flex-1 overflow-hidden outline-none;
}

.editor-tab-content[data-state='inactive'] {
  display: none;
}

.editor-welcome,
.editor-state {
  @apply flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto p-6 text-center text-xs;

  color: var(--muted-foreground);
  overflow-wrap: anywhere;
}

.editor-state {
  @apply h-full;
}

.editor-welcome h1 {
  @apply text-lg font-medium;

  color: var(--foreground);
}

.editor-state h2 {
  @apply text-sm font-medium;

  color: var(--foreground);
}

.editor-state-actions {
  @apply mt-1 flex flex-wrap justify-center gap-2;
}
</style>
