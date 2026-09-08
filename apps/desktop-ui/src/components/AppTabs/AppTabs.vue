<script setup lang="ts">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui';

defineProps<{ modelValue: string; items: readonly { value: string; label: string }[]; label: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
</script>
<template>
  <TabsRoot class="app-tabs" :model-value="modelValue" @update:model-value="emit('update:modelValue', String($event))">
    <TabsList class="app-tabs-list" :aria-label="label">
      <TabsTrigger v-for="item in items" :key="item.value" :value="item.value" class="app-tabs-trigger">{{
        item.label
      }}</TabsTrigger>
    </TabsList>
    <TabsContent :value="modelValue" class="app-tabs-content"><slot /></TabsContent>
  </TabsRoot>
</template>
<style scoped lang="scss">
.app-tabs {
  @apply flex min-h-0 min-w-0 flex-1 flex-col;
}
.app-tabs-list {
  @apply flex shrink-0 flex-wrap gap-1 border-b;
  border-color: var(--border-subtle);
}
.app-tabs-trigger {
  @apply border-0 border-b-2 bg-transparent px-3 py-2 outline-none;
  border-bottom-color: transparent;
  color: var(--muted-foreground);
  font-size: var(--ui-font-size);
  min-height: var(--control-height-sm);
}
.app-tabs-trigger[data-state='active'] {
  border-bottom-color: var(--primary-solid);
  color: var(--foreground);
}
.app-tabs-trigger:hover {
  background: var(--surface-hover);
}
.app-tabs-trigger:focus-visible {
  box-shadow: var(--input-focus-shadow);
}
.app-tabs-content {
  @apply flex min-h-0 min-w-0 flex-1 flex-col outline-none;
}
</style>
