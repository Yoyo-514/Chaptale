<script setup lang="ts">
import type { ChaptaleModelInfo } from '@chaptale/ipc-contract';

import AppButton from '@/components/AppButton/AppButton.vue';
import AppCheckbox from '@/components/AppCheckbox/AppCheckbox.vue';

const props = defineProps<{
  models: ChaptaleModelInfo[];
  isLoading: boolean;
}>();

const emit = defineEmits<{
  editCustomModel: [model: ChaptaleModelInfo];
  setDefault: [provider: string, modelId: string];
  toggleImageInput: [model: ChaptaleModelInfo, checked: boolean];
  removeCustomModel: [provider: string, modelId: string];
}>();
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
        <AppButton
          v-if="model.isCustom"
          icon
          variant="secondary"
          type="button"
          :disabled="props.isLoading"
          aria-label="编辑自定义模型"
          @click="emit('editCustomModel', model)"
        >
          <span class="i-mingcute-edit-2-line size-4" aria-hidden="true" />
        </AppButton>
        <label v-if="model.isCustom" class="settings-inline-check">
          <AppCheckbox
            :model-value="model.input.includes('image')"
            :disabled="props.isLoading"
            aria-label="切换图像输入支持"
            @update:model-value="emit('toggleImageInput', model, $event === true)"
          />
          <span>图像</span>
        </label>
        <AppButton
          v-if="model.isCustom"
          icon
          variant="danger"
          type="button"
          :disabled="props.isLoading"
          aria-label="删除自定义模型"
          @click="emit('removeCustomModel', model.provider, model.id)"
        >
          <span class="i-mingcute-delete-2-line size-4" aria-hidden="true" />
        </AppButton>
      </div>
    </article>
  </div>
</template>
