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
