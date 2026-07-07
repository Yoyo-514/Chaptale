<script setup lang="ts">
import type { ChaptaleModelInfo } from '@chaptale/ipc-contract';
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui';

import LlmModelList from './LlmModelList.vue';
import LlmProviderAuthPanel from './LlmProviderAuthPanel.vue';
import type { ModelGroup, ProviderView } from '../utils/llm-settings.helpers';

const props = defineProps<{
  provider: ProviderView;
  activeModelGroup: ModelGroup;
  apiKey?: string;
  isKeySaving: boolean;
  keyPlaceholder: string;
  isModelsLoading: boolean;
  models: ChaptaleModelInfo[];
}>();

const emit = defineEmits<{
  updateApiKey: [value: string];
  submitApiKey: [];
  removeProviderAuth: [];
  openCustomModelDialog: [];
  editCustomModel: [model: ChaptaleModelInfo];
  setDefault: [provider: string, modelId: string];
  toggleImageInput: [model: ChaptaleModelInfo, checked: boolean];
  removeCustomModel: [provider: string, modelId: string];
}>();
</script>

<template>
  <ScrollAreaRoot class="settings-scroll-root">
    <ScrollAreaViewport class="settings-scroll-viewport">
      <div class="settings-provider-detail">
        <div class="settings-provider-head">
          <div>
            <h4 class="settings-subtitle">{{ props.provider.providerName }}</h4>
            <p class="settings-section-description">
              供应商 ID：<code>{{ props.provider.provider }}</code>
            </p>
          </div>
          <span class="settings-pill">{{ props.provider.authConfigured ? '已配置 Key' : '未配置 Key' }}</span>
        </div>

        <LlmProviderAuthPanel
          :provider="props.provider"
          :active-model-group="props.activeModelGroup"
          :api-key="props.apiKey"
          :is-saving="props.isKeySaving"
          :placeholder="props.keyPlaceholder"
          @update:api-key="emit('updateApiKey', $event)"
          @submit="emit('submitApiKey')"
          @remove="emit('removeProviderAuth')"
        />

        <div v-if="props.activeModelGroup === 'custom'" class="settings-actions compact">
          <button class="settings-primary-button" type="button" @click="emit('openCustomModelDialog')">添加模型</button>
        </div>

        <LlmModelList
          :models="props.models"
          :is-loading="props.isModelsLoading"
          @edit-custom-model="emit('editCustomModel', $event)"
          @set-default="(provider, modelId) => emit('setDefault', provider, modelId)"
          @toggle-image-input="(model, checked) => emit('toggleImageInput', model, checked)"
          @remove-custom-model="(provider, modelId) => emit('removeCustomModel', provider, modelId)"
        />
      </div>
    </ScrollAreaViewport>
    <ScrollAreaScrollbar class="settings-scrollbar" orientation="vertical">
      <ScrollAreaThumb class="settings-scrollbar-thumb" />
    </ScrollAreaScrollbar>
  </ScrollAreaRoot>
</template>
