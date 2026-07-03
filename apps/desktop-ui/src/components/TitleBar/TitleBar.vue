<script setup lang="ts">
import { onMounted, ref } from 'vue';

const isDesktop = typeof window !== 'undefined' && Boolean(window.chaptaleDesktop);
const isMaximized = ref(false);

async function refreshWindowState() {
  const state = await window.chaptaleDesktop?.windowControl.isMaximized().catch(() => undefined);
  isMaximized.value = state?.isMaximized ?? false;
}

async function handleMinimize() {
  await window.chaptaleDesktop?.windowControl.minimize();
}

async function handleToggleMaximize() {
  const state = await window.chaptaleDesktop?.windowControl.toggleMaximize();
  isMaximized.value = state?.isMaximized ?? false;
}

async function handleClose() {
  await window.chaptaleDesktop?.windowControl.close();
}

onMounted(() => {
  void refreshWindowState();
});
</script>

<template>
  <header class="titlebar">
    <div class="titlebar-drag-region" @dblclick="handleToggleMaximize">
      <div class="titlebar-brand">
        <img class="titlebar-icon" src="/favicon.ico" alt="Chaptale" />
        <span class="titlebar-text">Chaptale</span>
      </div>

      <div class="titlebar-controls" aria-label="窗口控制" @dblclick.stop>
        <button
          class="titlebar-control"
          type="button"
          :disabled="!isDesktop"
          aria-label="最小化"
          @click="handleMinimize"
        >
          <span class="i-mingcute-minimize-line" aria-hidden="true" />
        </button>
        <button
          class="titlebar-control"
          type="button"
          :disabled="!isDesktop"
          :aria-label="isMaximized ? '还原窗口' : '最大化窗口'"
          @click="handleToggleMaximize"
        >
          <span :class="isMaximized ? 'i-mingcute-restore-line' : 'i-mingcute-square-line'" aria-hidden="true" />
        </button>
        <button
          class="titlebar-control titlebar-control-close"
          type="button"
          :disabled="!isDesktop"
          aria-label="关闭窗口"
          @click="handleClose"
        >
          <span class="i-mingcute-close-line" aria-hidden="true" />
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped lang="scss">
.titlebar {
  @apply h-9 shrink-0 select-none border-b border-titlebar-border bg-titlebar text-titlebar-foreground;
}

.titlebar-drag-region {
  @apply box-border flex h-full items-center justify-between pl-3;

  -webkit-app-region: drag;
  app-region: drag;
}

.titlebar-brand {
  @apply flex items-center gap-1.5;

  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.titlebar-icon {
  @apply h-5 w-5;
}

.titlebar-text {
  @apply text-[13px] text-titlebar-foreground;
}

.titlebar-controls {
  @apply ml-auto flex h-full items-center;

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
