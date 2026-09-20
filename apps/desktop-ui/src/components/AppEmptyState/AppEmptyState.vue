<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    description?: string;
    icon?: string;
  }>(),
  { description: undefined, icon: undefined }
);
</script>

<template>
  <div class="app-empty-state" role="status">
    <span v-if="icon" :class="icon" class="app-empty-state-icon" aria-hidden="true" />
    <p class="app-empty-state-title">{{ title }}</p>
    <p v-if="description || $slots.description" class="app-empty-state-description">
      <slot name="description">{{ description }}</slot>
    </p>
    <div v-if="$slots.default" class="app-empty-state-actions"><slot /></div>
  </div>
</template>

<style lang="scss">
.app-empty-state {
  @apply flex flex-col items-center gap-1 px-4 py-6 text-center;
  color: var(--muted-foreground);
  font-size: var(--ui-font-size);
}
.app-empty-state-icon {
  @apply mb-1 size-5;
}
.app-empty-state-title {
  @apply m-0;
  color: var(--foreground);
}
.app-empty-state-description {
  @apply m-0 max-w-64;
  font-size: var(--ui-caption-size);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.app-empty-state-actions {
  @apply mt-2 flex flex-wrap justify-center gap-2;
}
</style>
