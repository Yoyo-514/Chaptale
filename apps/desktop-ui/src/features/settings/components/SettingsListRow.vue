<script setup lang="ts">
withDefaults(defineProps<{ title?: string; muted?: boolean }>(), { title: undefined, muted: false });
</script>

<template>
  <li class="settings-list-row" :class="{ 'is-muted': muted }">
    <div class="settings-list-row-main">
      <div class="settings-list-row-copy">
        <div v-if="title || $slots.badges" class="settings-list-row-title">
          <strong v-if="title">{{ title }}</strong>
          <slot name="badges" />
        </div>
        <slot />
      </div>
      <!-- 次要操作：悬停或键盘聚焦到本行时才显示。 -->
      <div v-if="$slots.actions" class="settings-list-row-actions"><slot name="actions" /></div>
      <div v-if="$slots.trailing" class="settings-list-row-trailing"><slot name="trailing" /></div>
    </div>
    <slot name="extra" />
  </li>
</template>

<style lang="scss">
.settings-list-row {
  @apply flex min-w-0 flex-col gap-2 px-3.5 py-2.5;
}

.settings-list-row-main {
  @apply flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-2;
}

.settings-list-row-copy {
  @apply flex flex-1 flex-col gap-1;

  min-width: 12rem;

  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.settings-list-row.is-muted .settings-list-row-copy {
  opacity: 0.65;
}

.settings-list-row-title {
  @apply flex flex-wrap items-center gap-2;
}

.settings-list-row-title > strong {
  color: var(--foreground);
  font-size: var(--ui-font-size);
  font-weight: 600;
}

.settings-list-row-copy code {
  color: var(--foreground);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  font-size: var(--ui-caption-size);
  word-break: break-all;
}

.settings-list-row-actions,
.settings-list-row-trailing {
  @apply flex shrink-0 items-center gap-1;
}

.settings-list-row-actions {
  opacity: 0;
  transition: opacity var(--motion-duration) ease-out;
}

.settings-list-row:hover .settings-list-row-actions,
.settings-list-row:focus-within .settings-list-row-actions {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .settings-list-row-actions {
    transition: none;
  }
}
</style>
