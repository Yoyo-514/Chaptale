<script setup lang="ts">
import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';

/** 关系与事件块内的一节：小标题、待接受与正式条数，右侧为新增按钮。 */
defineProps<{ title: string; count: number; pending: number; addLabel?: string; addDisabled?: boolean }>();
const emit = defineEmits<{ add: [] }>();
</script>

<template>
  <section class="story-section" role="region" :aria-label="title">
    <header class="story-section-head">
      <h3 class="story-section-title">{{ title }}</h3>
      <span v-if="pending" class="story-section-pending">{{ pending }} 条待接受</span>
      <span class="story-section-count">{{ count ? `${count} 条` : '' }}</span>
      <AppTooltip v-if="addLabel" :text="`添加${addLabel}`">
        <AppButton
          icon
          size="xs"
          variant="ghost"
          :aria-label="`添加${addLabel}`"
          :disabled="addDisabled"
          @click="emit('add')"
        >
          <span class="i-mingcute-add-line size-3.5" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
    </header>
    <slot />
  </section>
</template>

<style scoped>
.story-section {
  max-width: 672px;
  padding: 0 16px 8px 36px;
}
.story-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  margin-top: 4px;
}
.story-section-title {
  margin: 0;
  color: var(--foreground);
  font-size: var(--ui-font-size);
  font-weight: 500;
}
.story-section-count {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  white-space: nowrap;
}
.story-section-pending {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--radius-control-sm);
  background: color-mix(in srgb, var(--warning) 16%, transparent);
  color: var(--foreground);
  font-size: var(--ui-caption-size);
  line-height: 20px;
}
</style>
