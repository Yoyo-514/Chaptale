<script setup lang="ts">
import type { ModelGroup } from '../utils/llm-settings.helpers';

const props = defineProps<{
  activeGroup: ModelGroup;
  builtinCount: number;
  customCount: number;
}>();

const emit = defineEmits<{
  select: [group: ModelGroup];
}>();
</script>

<template>
  <div class="settings-group-tabs" role="tablist" aria-label="模型来源">
    <button
      class="settings-group-tab"
      :class="{ 'is-active': props.activeGroup === 'builtin' }"
      type="button"
      @click="emit('select', 'builtin')"
    >
      内置模型 <span>{{ props.builtinCount }}</span>
    </button>
    <button
      class="settings-group-tab"
      :class="{ 'is-active': props.activeGroup === 'custom' }"
      type="button"
      @click="emit('select', 'custom')"
    >
      自定义模型 <span>{{ props.customCount }}</span>
    </button>
  </div>
</template>
