<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

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

/**
 * 文档标题两侧的对称安全区取自左侧菜单区的实测宽度。
 *
 * 菜单区宽度不随窗口变化，但样式与字体就位后会变（挂载那一刻量到的不作数），
 * 所以用 ResizeObserver 持续跟随；量不到时保持样式里的兜底值，
 * 避免安全区失效后长标题压住菜单。
 */
const dragRegion = ref<HTMLElement | null>(null);
const leading = ref<HTMLElement | null>(null);
let leadingObserver: ResizeObserver | undefined;

onMounted(() => {
  const element = leading.value;
  const region = dragRegion.value;
  if (!element || !region) return;

  // 取左菜单区的右边缘（相对标题栏左边缘，含它前面的内边距）向上取整：
  // 它是标题真正越不过去的边界，向上取整保证高 DPI 下的亚像素误差也不会贴上去。
  leadingObserver = new ResizeObserver(() => {
    const right = Math.ceil(element.getBoundingClientRect().right - region.getBoundingClientRect().left);
    if (right > 0) region.style.setProperty('--titlebar-side-clearance', `${right}px`);
  });
  leadingObserver.observe(element);
});

onBeforeUnmount(() => leadingObserver?.disconnect());

const { isDesktop, isMaximized, minimize, toggleMaximize, close } = useWindowControls();
</script>

<template>
  <header class="titlebar">
    <div ref="dragRegion" class="titlebar-drag-region" @dblclick="toggleMaximize">
      <div ref="leading" class="titlebar-leading" role="group" aria-label="Chaptale 应用菜单" @dblclick.stop>
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
  /* 标题两侧安全区的兜底宽度：约等于左侧「图标 + 菜单 + 内边距」；挂载后由实测值覆盖。 */
  --titlebar-side-clearance: 22rem;

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
  @apply pointer-events-none absolute top-1/2 left-1/2 w-max -translate-x-1/2 -translate-y-1/2 truncate px-3 text-center text-xs;

  /* 以整条标题栏为基准居中；两侧各留一份与左侧菜单区等宽的安全区，长标题只截断、不压菜单。 */
  max-width: calc(100% - 2 * var(--titlebar-side-clearance));
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
</style>
