<script setup lang="ts">
import { AppButton } from '@/components/AppButton';

withDefaults(
  defineProps<{
    title: string;
    description?: string;
    meta?: string;
    selected?: boolean;
    /** 单行密排：与目录树同高（28px），标题截断，元信息靠右。 */
    dense?: boolean;
  }>(),
  { description: undefined, meta: undefined, selected: false, dense: false }
);
</script>

<template>
  <AppButton variant="ghost" class="app-list-item" :class="{ 'is-dense': dense }" :selected="selected">
    <span v-if="$slots.leading" class="app-list-item-leading"><slot name="leading" /></span>
    <span class="app-list-item-copy">
      <strong class="app-list-item-title">{{ title }}</strong>
      <span v-if="!dense && (description || $slots.description)" class="app-list-item-description">
        <slot name="description">{{ description }}</slot>
      </span>
      <small v-if="meta || $slots.meta" class="app-list-item-meta"
        ><slot name="meta">{{ meta }}</slot></small
      >
    </span>
    <span v-if="$slots.trailing" class="app-list-item-trailing"><slot name="trailing" /></span>
  </AppButton>
</template>

<style lang="scss">
.app-list-item {
  @apply flex h-auto w-full min-w-0 items-start justify-start gap-2 rounded-none border-0 px-3 py-1.5 text-left font-normal;
  min-height: 28px;
  white-space: normal;
  overflow-wrap: anywhere;
  color: var(--foreground);
  // 行背景是块状高亮，跟着过渡淡入会拖慢指针反馈。
  transition: none;
}
.app-list-item.app-button-selected {
  background: var(--accent);
  color: var(--accent-foreground);
}
.app-list-item.app-button-selected .app-list-item-leading,
.app-list-item.app-button-selected .app-list-item-description,
.app-list-item.app-button-selected .app-list-item-meta {
  color: inherit;
  opacity: 0.85;
}
.app-list-item-leading {
  @apply mt-px flex size-4 shrink-0 items-center justify-center;
  color: var(--muted-foreground);
}
.app-list-item-copy {
  @apply flex min-w-0 flex-1 flex-col gap-0.5;
}
.app-list-item-title {
  @apply font-medium;
  line-height: 1.5;
}
.app-list-item-description {
  @apply line-clamp-2;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  line-height: 1.55;
}
.app-list-item-meta {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  font-variant-numeric: tabular-nums;
  line-height: 1.5;
}
.app-list-item-trailing {
  @apply flex shrink-0 items-center gap-1 self-center;
}

.app-list-item.is-dense {
  @apply h-7 items-center py-0;
  min-height: 28px;
}
.app-list-item.is-dense .app-list-item-leading {
  @apply mt-0;
}
.app-list-item.is-dense .app-list-item-copy {
  @apply flex-row items-baseline gap-2;
}
.app-list-item.is-dense .app-list-item-title {
  @apply min-w-0 flex-1 truncate font-normal;
}
.app-list-item.is-dense .app-list-item-meta {
  @apply shrink-0 truncate;
  max-width: 45%;
}
</style>
