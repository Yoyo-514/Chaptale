<script setup lang="ts">
import { AppButton } from '@/components/AppButton';
import { useNotificationStore } from '@/stores/notification';
import { useSettingsStore } from '@/stores/settings';

import LlmAddCustomModelPanel from '../components/LlmAddCustomModelPanel.vue';
import LlmCustomProviderForm from '../components/LlmCustomProviderForm.vue';
import LlmModelGroupTabs from '../components/LlmModelGroupTabs.vue';
import LlmProviderDetail from '../components/LlmProviderDetail.vue';
import LlmProviderList from '../components/LlmProviderList.vue';
import SettingsSection from '../components/SettingsSection.vue';
import { useLlmCustomModelForms } from '../composables/useLlmCustomModelForms';
import { useLlmModelActions } from '../composables/useLlmModelActions';
import { useLlmProviderAuth } from '../composables/useLlmProviderAuth';
import { useLlmSettingsState } from '../composables/useLlmSettingsState';

const notificationStore = useNotificationStore();
const settingsStore = useSettingsStore();
const {
  selectedProviderId,
  activeModelGroup,
  providerViews,
  selectedProvider,
  selectedProviderModels,
  builtinCount,
  customCount,
  defaultModelLabel,
  setModelGroup,
  selectProvider
} = useLlmSettingsState(settingsStore);
const { providerApiKeys, getApiKeyPlaceholder, isApiKeySaving, submitProviderApiKey, removeProviderApiKey } =
  useLlmProviderAuth(settingsStore, notificationStore, activeModelGroup);
const {
  isCustomFormOpen,
  isCustomModelDialogOpen,
  customModelDialogTitle,
  customModelSubmitLabel,
  pendingModelProvider,
  customProvider,
  providerModelDraft,
  stagedProviderModels,
  customModelDraft,
  fetchedCustomModels,
  fetchedModelOptions,
  fetchCustomModels,
  fetchCustomModelsForProvider,
  stageProviderModel,
  removeStagedProviderModel,
  openAddCustomModelDialog,
  openEditCustomModelDialog,
  submitCustomModelToProvider,
  submitCustomProvider
} = useLlmCustomModelForms(
  settingsStore,
  notificationStore,
  activeModelGroup,
  selectedProviderId,
  selectedProviderModels
);
const { removeCustomModel, setDefaultModel, toggleImageInput } = useLlmModelActions(settingsStore);
</script>

<template>
  <SettingsSection
    class="llm-settings"
    title="模型服务"
    title-id="settings-provider-title"
    description="管理内置模型与自定义模型。自定义模型的服务地址、模型 ID 与 API Key 会保存在模型配置中；内置模型的 API Key 会保存在 API Key 配置中。"
    :scrollable="false"
  >
    <template #actions>
      <div class="settings-heading-actions">
        <AppButton type="button" @click="isCustomFormOpen = true">添加供应商</AppButton>
        <AppButton type="button" :disabled="settingsStore.isModelsLoading" @click="settingsStore.loadModels()">
          刷新模型
        </AppButton>
      </div>
    </template>

    <div class="settings-summary-card">
      <span class="settings-path-label">当前默认模型</span>
      <strong>{{ defaultModelLabel }}</strong>
    </div>

    <LlmModelGroupTabs
      :active-group="activeModelGroup"
      :builtin-count="builtinCount"
      :custom-count="customCount"
      @select="setModelGroup"
    />

    <div v-if="settingsStore.isModelsLoading" class="settings-empty-card">正在读取模型清单...</div>
    <div v-else-if="!providerViews.length" class="settings-empty-card">
      {{
        activeModelGroup === 'custom' ? '暂无自定义供应商。点击右上角添加供应商。' : '暂无内置模型。请稍后刷新重试。'
      }}
    </div>
    <div v-else class="settings-model-layout">
      <LlmProviderList
        :providers="providerViews"
        :selected-provider-id="selectedProvider?.provider"
        @select="selectProvider"
      />

      <LlmProviderDetail
        v-if="selectedProvider"
        :provider="selectedProvider"
        :active-model-group="activeModelGroup"
        :api-key="providerApiKeys[selectedProvider.provider]"
        :is-api-key-saving="isApiKeySaving(selectedProvider.provider)"
        :api-key-placeholder="getApiKeyPlaceholder(selectedProvider)"
        :is-models-loading="settingsStore.isModelsLoading"
        :models="selectedProviderModels"
        @update-api-key="providerApiKeys[selectedProvider.provider] = $event"
        @submit-api-key="submitProviderApiKey(selectedProvider.provider)"
        @remove-api-key="removeProviderApiKey(selectedProvider.provider)"
        @open-custom-model-dialog="openAddCustomModelDialog"
        @edit-custom-model="openEditCustomModelDialog"
        @set-default="setDefaultModel"
        @toggle-image-input="toggleImageInput"
        @remove-custom-model="removeCustomModel"
      />
    </div>

    <LlmCustomProviderForm
      v-model:open="isCustomFormOpen"
      :provider="customProvider"
      :draft="providerModelDraft"
      :staged-models="stagedProviderModels"
      :fetched-models="fetchedCustomModels"
      :is-fetching="settingsStore.isFetchingCustomModels"
      :is-loading="settingsStore.isModelsLoading"
      :can-fetch="
        Boolean(customProvider.baseUrl && customProvider.apiKey) && customProvider.api !== 'anthropic-messages'
      "
      :can-stage-model="Boolean(providerModelDraft.modelId)"
      :can-submit="Boolean(customProvider.provider && customProvider.providerName && customProvider.baseUrl)"
      @fetch="fetchCustomModels"
      @stage-model="stageProviderModel"
      @remove-staged-model="removeStagedProviderModel"
      @submit="submitCustomProvider"
    />

    <LlmAddCustomModelPanel
      v-if="selectedProvider"
      v-model:open="isCustomModelDialogOpen"
      :title="customModelDialogTitle"
      :submit-label="customModelSubmitLabel"
      :draft="customModelDraft"
      :fetched-models="fetchedModelOptions"
      :is-fetching="pendingModelProvider === selectedProvider.provider"
      :can-fetch="selectedProvider.authConfigured && !settingsStore.isFetchingCustomModels"
      :can-submit="Boolean(customModelDraft.modelId)"
      @fetch="fetchCustomModelsForProvider(selectedProvider.provider)"
      @submit="submitCustomModelToProvider(selectedProvider.provider)"
    />
  </SettingsSection>
</template>

<style lang="scss">
@use '../styles/llm-settings';
</style>
