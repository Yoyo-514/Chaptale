<script setup lang="ts">
const props = defineProps<{
  damagedEntryCount: number;
}>();
</script>

<template>
  <section class="session-damage-notice" data-slot="session-damage-notice" aria-label="会话文件损坏">
    <span class="i-mingcute-alert-line session-damage-icon" aria-hidden="true" />
    <p class="session-damage-copy">
      <strong>会话文件有 {{ props.damagedEntryCount }} 条记录损坏</strong>
      <span>损坏位置更早的历史可能不再显示，模型也读不到它们。</span>
    </p>
  </section>
</template>

<style scoped lang="scss">
/* 常驻且不可关闭：文件损坏没有终态，关掉下次打开还会出现。
   既然要一直在，就得压到一行的重量——不给按钮，也不占正文的位置。
   宽度与居中由 chat-input-topbar 提供，与同区其他卡片对齐。 */
.session-damage-notice {
  @apply flex items-start gap-2 rounded-lg border px-3 py-2 text-sm;

  border-color: color-mix(in srgb, var(--warning, #b45309) 40%, transparent);
  background: color-mix(in srgb, var(--warning, #b45309) 7%, transparent);
}

.session-damage-icon {
  @apply mt-0.5 size-4 shrink-0;

  color: var(--warning, #b45309);
}

.session-damage-copy {
  @apply m-0 flex min-w-0 flex-1 flex-col;

  span {
    @apply text-xs;

    color: var(--muted-foreground);
  }
}
</style>
