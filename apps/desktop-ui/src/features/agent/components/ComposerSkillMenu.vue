<script setup lang="ts">
import type { SessionSkillItem } from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';

defineProps<{
  items: SessionSkillItem[];
  activeIndex: number;
  query: string;
}>();

const emit = defineEmits<{
  select: [item: SessionSkillItem];
  hover: [index: number];
  openSettings: [];
}>();
</script>

<template>
  <div class="agent-skill-menu" role="listbox" aria-label="可用技能">
    <template v-if="items.length">
      <button
        v-for="(item, index) in items"
        :key="`${item.scope}:${item.name}`"
        type="button"
        role="option"
        class="agent-skill-option"
        :class="{ 'is-active': index === activeIndex }"
        :aria-selected="index === activeIndex"
        @mouseenter="emit('hover', index)"
        @mousedown.prevent
        @click="emit('select', item)"
      >
        <div class="agent-skill-option-head">
          <span class="agent-skill-option-name">/skill:{{ item.name }}</span>
          <span v-if="item.scope === 'work'" class="agent-skill-option-tag">当前作品</span>
          <span v-if="item.disableModelInvocation" class="agent-skill-option-tag">仅手动</span>
        </div>
        <span class="agent-skill-option-desc">{{ item.description }}</span>
      </button>
    </template>
    <div v-else class="agent-skill-empty">
      <span>{{ query ? `未找到匹配“${query}”的技能` : '当前没有已启用的技能' }}</span>
      <AppButton type="button" size="xs" variant="ghost" @mousedown.prevent @click="emit('openSettings')">
        技能设置…
      </AppButton>
    </div>
  </div>
</template>

<style lang="scss">
.agent-skill-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: var(--z-local-popover);
  display: flex;
  max-height: 15rem;
  flex-direction: column;
  gap: 2px;
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-overlay);
  background: var(--popover);
  color: var(--popover-foreground);
  box-shadow: var(--shadow-float);
}
.agent-skill-option {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--foreground);
  text-align: left;
  cursor: pointer;
}
.agent-skill-option:hover,
.agent-skill-option.is-active {
  background: var(--secondary);
  color: var(--secondary-foreground);
}
.agent-skill-option-head {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 6px;
}
.agent-skill-option-name {
  font-size: var(--ui-font-size);
  font-weight: 600;
}
.agent-skill-option-tag {
  flex-shrink: 0;
  padding: 1px 6px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control-sm);
  background: var(--surface);
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  line-height: 1.4;
}
.agent-skill-option-desc {
  width: 100%;
  overflow: hidden;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-skill-empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
</style>
