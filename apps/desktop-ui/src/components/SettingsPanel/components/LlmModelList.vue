<script setup lang="ts">
import type { ChaptaleModelInfo } from '@chaptale/ipc-contract';

const props = defineProps<{
  models: ChaptaleModelInfo[];
  isLoading: boolean;
}>();

const emit = defineEmits<{
  setDefault: [provider: string, modelId: string];
  toggleImageInput: [model: ChaptaleModelInfo, checked: boolean];
  removeCustomModel: [provider: string, modelId: string];
}>();

function emitToggleImageInput(model: ChaptaleModelInfo, event: Event) {
  emit('toggleImageInput', model, (event.target as HTMLInputElement).checked);
}
</script>

<template>
  <div class="settings-model-list">
    <article
      v-for="model in props.models"
      :key="model.id"
      class="settings-model-row"
      :class="{ 'is-default': model.isDefault }"
      role="button"
      tabindex="0"
      @click="emit('setDefault', model.provider, model.id)"
      @keydown.enter.prevent="emit('setDefault', model.provider, model.id)"
      @keydown.space.prevent="emit('setDefault', model.provider, model.id)"
    >
      <div class="settings-model-copy">
        <span class="settings-model-title-line">
          <strong>{{ model.name }}</strong>
          <span v-if="model.isDefault" class="settings-default-badge">默认</span>
        </span>
        <code>{{ model.id }}</code>
        <span class="settings-model-info">
          {{ model.reasoning ? 'Reasoning' : 'Standard' }} ·
          {{ model.input.includes('image') ? 'Text + Image' : 'Text' }} ·
          {{ model.contextWindow.toLocaleString() }} tokens
        </span>
      </div>
      <div class="settings-model-actions" @click.stop>
        <label v-if="model.isCustom" class="settings-inline-check">
          <input
            type="checkbox"
            :checked="model.input.includes('image')"
            :disabled="props.isLoading"
            @change="emitToggleImageInput(model, $event)"
          />
          <span>图像</span>
        </label>
        <button
          v-if="model.isCustom"
          class="settings-danger-icon-button"
          type="button"
          :disabled="props.isLoading"
          aria-label="删除自定义模型"
          @click="emit('removeCustomModel', model.provider, model.id)"
        >
          <span class="i-mingcute-delete-2-line size-4" aria-hidden="true" />
        </button>
      </div>
    </article>
  </div>
</template>
