<script setup lang="ts">
import type { ChaptaleModelInfo, FetchedCustomProviderModel } from '@chaptale/ipc-contract';
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui';

import LlmAddCustomModelPanel from './LlmAddCustomModelPanel.vue';
import LlmModelList from './LlmModelList.vue';
import LlmProviderAuthPanel from './LlmProviderAuthPanel.vue';
import type { CustomModelDraft } from '../utils/custom-model-draft';
import type { ModelGroup, ProviderView } from '../utils/llm-settings.helpers';

const props = defineProps<{
  provider: ProviderView;
  activeModelGroup: ModelGroup;
  apiKey?: string;
  isKeySaving: boolean;
  keyPlaceholder: string;
  customModelDraft: CustomModelDraft;
  addableFetchedModels: FetchedCustomProviderModel[];
  pendingModelProvider: string;
  isFetchingCustomModels: boolean;
  isModelsLoading: boolean;
  models: ChaptaleModelInfo[];
}>();

const emit = defineEmits<{
  updateApiKey: [value: string];
  submitApiKey: [];
  removeProviderAuth: [];
  fetchCustomModels: [provider: string];
  submitCustomModel: [provider: string];
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

        <LlmAddCustomModelPanel
          v-if="props.activeModelGroup === 'custom'"
          :draft="props.customModelDraft"
          :fetched-models="props.addableFetchedModels"
          :is-fetching="props.pendingModelProvider === props.provider.provider"
          :can-fetch="props.provider.authConfigured && !props.isFetchingCustomModels"
          :can-submit="Boolean(props.customModelDraft.modelId)"
          @fetch="emit('fetchCustomModels', props.provider.provider)"
          @submit="emit('submitCustomModel', props.provider.provider)"
        />

        <LlmModelList
          :models="props.models"
          :is-loading="props.isModelsLoading"
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
