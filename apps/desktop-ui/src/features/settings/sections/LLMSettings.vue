<script setup lang="ts">
import { AppButton } from '@/components/AppButton';
import { useNotificationStore } from '@/features/notifications';

import LlmAddCustomModelPanel from '../components/LlmAddCustomModelPanel.vue';
import LlmCustomProviderForm from '../components/LlmCustomProviderForm.vue';
import LlmProviderDetail from '../components/LlmProviderDetail.vue';
import LlmProviderList from '../components/LlmProviderList.vue';
import SettingsSection from '../components/SettingsSection.vue';
import { useLlmCustomModelForms } from '../composables/useLlmCustomModelForms';
import { useLlmModelActions } from '../composables/useLlmModelActions';
import { useLlmProviderAuth } from '../composables/useLlmProviderAuth';
import { useLlmSettingsState } from '../composables/useLlmSettingsState';
import { useSettingsStore } from '../store';

const notificationStore = useNotificationStore();
const settingsStore = useSettingsStore();
const {
  selectedProviderId,
  providerViews,
  selectedProvider,
  selectedProviderModels,
  defaultModelLabel,
  selectProvider
} = useLlmSettingsState(settingsStore);
const { providerApiKeys, getApiKeyPlaceholder, isApiKeySaving, submitProviderApiKey, removeProviderApiKey } =
  useLlmProviderAuth(settingsStore, notificationStore);
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
} = useLlmCustomModelForms(settingsStore, notificationStore, selectedProviderId, selectedProviderModels);
const { removeCustomModel, setDefaultModel, toggleImageInput } = useLlmModelActions(settingsStore);
</script>

<template>
  <SettingsSection
    class="llm-settings"
    title="模型服务"
    title-id="settings-provider-title"
    description="管理模型供应商：添加服务商、配置 API Key 与模型清单。所有配置保存在 models.json，可随时刷新同步。"
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

    <div v-if="settingsStore.isModelsLoading" class="settings-empty-card">正在读取模型清单...</div>
    <div v-else-if="!providerViews.length" class="settings-empty-card">
      暂无模型供应商。点击右上角「添加供应商」，填入服务地址与 API Key 即可开始使用。
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
