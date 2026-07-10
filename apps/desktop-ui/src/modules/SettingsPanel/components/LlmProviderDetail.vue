<script setup lang="ts">
import type { ChaptaleModelInfo } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppScrollArea } from '@/components/AppScrollArea';
import type { ModelGroup, ProviderView } from '../utils/llm-settings.helpers';
import LlmModelList from './LlmModelList.vue';
import LlmProviderAuthPanel from './LlmProviderAuthPanel.vue';

const props = defineProps<{
  provider: ProviderView;
  activeModelGroup: ModelGroup;
  apiKey?: string;
  isApiKeySaving: boolean;
  apiKeyPlaceholder: string;
  isModelsLoading: boolean;
  models: ChaptaleModelInfo[];
}>();

const emit = defineEmits<{
  updateApiKey: [value: string];
  submitApiKey: [];
  removeApiKey: [];
  openCustomModelDialog: [];
  editCustomModel: [model: ChaptaleModelInfo];
  setDefault: [provider: string, modelId: string];
  toggleImageInput: [model: ChaptaleModelInfo, checked: boolean];
  removeCustomModel: [provider: string, modelId: string];
}>();
</script>

<template>
  <AppScrollArea class="settings-model-scroll">
    <div class="settings-provider-detail">
      <div class="settings-provider-head">
        <div>
          <h4 class="settings-subtitle">{{ props.provider.providerName }}</h4>
          <p class="settings-section-description">
            供应商 ID：<code>{{ props.provider.provider }}</code>
          </p>
        </div>
        <span class="settings-pill">{{ props.provider.authConfigured ? '已配置 API Key' : '未配置 API Key' }}</span>
      </div>

      <LlmProviderAuthPanel
        :api-key="props.apiKey"
        :is-saving="props.isApiKeySaving"
        :can-remove="props.provider.authConfigured"
        :placeholder="props.apiKeyPlaceholder"
        @update:api-key="emit('updateApiKey', $event)"
        @submit="emit('submitApiKey')"
        @remove="emit('removeApiKey')"
      />

      <div v-if="props.activeModelGroup === 'custom'" class="settings-actions compact">
        <AppButton variant="primary" type="button" @click="emit('openCustomModelDialog')">添加模型</AppButton>
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
  </AppScrollArea>
</template>
