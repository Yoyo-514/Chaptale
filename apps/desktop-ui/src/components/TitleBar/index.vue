<template>
  <header class="titlebar">
    <div class="titlebar-drag-region">
      <div class="titlebar-brand">
        <img class="titlebar-icon" src="/favicon.ico" alt="Chaptale" />
        <span class="titlebar-text">Chaptale</span>
      </div>
    </div>
  </header>
</template>

<style scoped lang="scss">
.titlebar {
  @apply h-9 shrink-0 select-none border-b border-titlebar-border bg-titlebar;
}

.titlebar-drag-region {
  @apply box-border flex h-full items-center px-3;

  -webkit-app-region: drag;
  app-region: drag;
  margin-left: env(titlebar-area-x, 0);
  width: env(titlebar-area-width, 100%);
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
</style>
