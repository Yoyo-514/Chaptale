<script setup lang="ts">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui';
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';
import { APP_ICON_URL } from '@/utils/app-icon';

import { useEditorStore } from '../store';

const DocumentView = defineAsyncComponent(() => import('./DocumentView.vue'));

const editor = useEditorStore();
const tabList = ref<HTMLElement | null>(null);
const duplicateTitles = computed(() => {
  const counts = new Map<string, number>();
  for (const tab of editor.tabs) counts.set(tab.title, (counts.get(tab.title) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([title]) => title));
});

async function closeTab(id: string) {
  const focusedInside = tabList.value?.contains(document.activeElement);
  editor.closeTab(id);
  if (focusedInside) {
    await nextTick();
    tabList.value?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }
}

function handleKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'w' && editor.activeId) {
    event.preventDefault();
    event.stopPropagation();
    void closeTab(editor.activeId);
  }
}

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
  <TabsRoot
    :model-value="editor.activeId || 'welcome'"
    class="editor-group"
    @update:model-value="value => editor.selectTab(String(value))"
    @keydown="handleKeydown"
  >
    <div ref="tabList" class="editor-tabs-scroll">
      <TabsList class="editor-tabs" aria-label="编辑器标签">
        <TabsTrigger v-if="!editor.tabs.length" value="welcome" class="editor-tab">欢迎</TabsTrigger>
        <div
          v-for="tab in editor.tabs"
          :key="tab.id"
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
      </TabsList>
    </div>

    <TabsContent v-if="!editor.tabs.length" value="welcome" class="editor-welcome">
      <img :src="APP_ICON_URL" alt="" width="44" height="44" aria-hidden="true" />
      <h1>Chaptale</h1>
      <p>尚未打开文件</p>
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
        :key="`${tab.id}:${tab.document.contentHash}:${tab.document.mtimeMs}`"
        :document="tab.document"
        :view-state="tab.viewState"
        :search-request="editor.searchRequest"
        @reload="editor.reloadDocument(tab.id)"
        @remember-view="state => editor.rememberView(tab.id, state)"
      />
    </TabsContent>
  </TabsRoot>
</template>

<style scoped lang="scss">
.editor-group {
  @apply flex h-full min-h-0 min-w-0 flex-col overflow-hidden;
}

.editor-tabs-scroll {
  @apply h-9 shrink-0 overflow-x-auto overflow-y-hidden border-b;

  border-color: var(--border-subtle);
  background: var(--surface-acrylic-subtle);
  scrollbar-width: thin;
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
  @apply flex h-full min-w-0 items-center gap-2 border-0 bg-transparent px-3 text-xs outline-none;

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

.editor-tab-parent {
  @apply max-w-24 truncate text-[11px];

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
