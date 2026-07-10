<script setup lang="ts">
import { computed, useSlots } from 'vue';

import { AppScrollArea } from '@/components/AppScrollArea';

const props = withDefaults(
  defineProps<{
    title: string;
    titleId?: string;
    description?: string;
    scrollable?: boolean;
  }>(),
  {
    scrollable: true
  }
);

const slots = useSlots();
const hasDescription = computed(() => Boolean(props.description || slots.description));
const hasHeadingExtra = computed(() => Boolean(slots.badge || slots.actions || slots.headerExtra));
</script>

<template>
  <section class="settings-section" :aria-labelledby="props.titleId">
    <div class="settings-section-heading">
      <h3 :id="props.titleId" class="settings-section-title">{{ props.title }}</h3>
      <div v-if="hasHeadingExtra" class="settings-section-heading-extra">
        <slot name="badge" />
        <slot name="actions" />
        <slot name="headerExtra" />
      </div>
    </div>

    <p v-if="hasDescription" class="settings-section-description">
      <slot name="description">{{ props.description }}</slot>
    </p>

    <AppScrollArea
      v-if="props.scrollable"
      class="settings-section-scroll"
      viewport-class="settings-section-scroll-viewport"
    >
      <slot />
    </AppScrollArea>
    <slot v-else />
  </section>
</template>

<style scoped lang="scss">
.settings-section {
  @apply flex h-full min-h-0 flex-col overflow-hidden p-2;

  background: var(--surface-acrylic-subtle);
}

.settings-section-heading {
  @apply flex items-center justify-between gap-3;
}

.settings-section-heading-extra {
  @apply flex shrink-0 items-center justify-end gap-2;
}

.settings-section-title {
  @apply m-0 text-sm font-semibold;
}

.settings-section-description {
  @apply mt-1 mb-3 text-xs leading-5;

  color: var(--muted-foreground);
}

.settings-section-scroll {
  @apply min-h-0 flex-1;
}

.settings-section-scroll :deep(.settings-section-scroll-viewport) {
  @apply flex flex-col;
}
</style>
