<script setup lang="ts">
import { computed } from 'vue';

import { useEditorStore } from '@/features/editor';
import { useWorkbenchStore, workspaceViews } from '@/features/workbench';
import { useWorkspaceStore } from '@/features/workspace';
import { APP_ICON_URL } from '@/utils/app-icon';

import TitleBarMenu from './TitleBarMenu.vue';
import { useWindowControls } from './useWindowControls';

const appIconUrl = APP_ICON_URL;
const workspace = useWorkspaceStore();
const editor = useEditorStore();
const navigation = useWorkbenchStore();
const documentTitle = computed(
  () =>
    [
      navigation.center === 'editor'
        ? editor.activeTab?.title
        : workspaceViews.find(view => view.id === navigation.center)?.label,
      workspace.displayName
    ]
      .filter(Boolean)
      .join(' - ') || 'Chaptale'
);

const { isDesktop, isMaximized, minimize, toggleMaximize, close } = useWindowControls();
</script>

<template>
  <header class="titlebar">
    <div class="titlebar-drag-region" @dblclick="toggleMaximize">
      <div class="titlebar-leading" role="group" aria-label="Chaptale 应用菜单" @dblclick.stop>
        <img class="titlebar-icon" :src="appIconUrl" alt="" aria-hidden="true" />
        <TitleBarMenu />
      </div>

      <div class="titlebar-document-title" :title="documentTitle">{{ documentTitle }}</div>

      <div class="titlebar-controls" aria-label="窗口控制" @dblclick.stop>
        <button class="titlebar-control" type="button" :disabled="!isDesktop" aria-label="最小化" @click="minimize">
          <span class="i-mingcute-minimize-line" aria-hidden="true" />
        </button>
        <button
          class="titlebar-control"
          type="button"
          :disabled="!isDesktop"
          :aria-label="isMaximized ? '还原窗口' : '最大化窗口'"
          @click="toggleMaximize"
        >
          <span :class="isMaximized ? 'i-mingcute-restore-line' : 'i-mingcute-square-line'" aria-hidden="true" />
        </button>
        <button
          class="titlebar-control titlebar-control-close"
          type="button"
          :disabled="!isDesktop"
          aria-label="关闭窗口"
          @click="close"
        >
          <span class="i-mingcute-close-line" aria-hidden="true" />
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped lang="scss">
.titlebar {
  @apply relative h-9 shrink-0 select-none border-b border-titlebar-border bg-titlebar text-titlebar-foreground;
}

.titlebar-drag-region {
  @apply box-border flex h-full items-center pl-2;

  -webkit-app-region: drag;
  app-region: drag;
}

.titlebar-leading {
  @apply flex min-w-0 items-center gap-1;

  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.titlebar-icon {
  @apply mx-1 shrink-0;

  width: 18px;
  height: 18px;
}

.titlebar-document-title {
  @apply pointer-events-none min-w-0 flex-1 truncate px-3 text-center text-xs;

  color: var(--muted-foreground);
}

.titlebar-controls {
  @apply ml-auto flex h-full shrink-0 items-center;

  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.titlebar-control {
  @apply flex-center h-8 w-10 border-0 bg-transparent p-0 text-titlebar-foreground outline-none hover:bg-titlebar-control-hover disabled:pointer-events-none disabled:opacity-40;
}

.titlebar-control-close {
  @apply hover:bg-destructive-background hover:text-destructive-background-foreground;
}

@media (max-width: 900px) {
  .titlebar-document-title {
    @apply hidden;
  }
  .titlebar-leading {
    overflow-x: auto;
  }
  .titlebar-control {
    width: 32px;
  }
}
</style>
