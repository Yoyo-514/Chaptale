<script setup lang="ts">
import LlmCustomProviderForm from '../components/LlmCustomProviderForm.vue';
import LlmModelGroupTabs from '../components/LlmModelGroupTabs.vue';
import LlmProviderDetail from '../components/LlmProviderDetail.vue';
import LlmProviderList from '../components/LlmProviderList.vue';
import { useLlmCustomModelForms } from '../composables/useLlmCustomModelForms';
import { useLlmModelActions } from '../composables/useLlmModelActions';
import { useLlmProviderAuth } from '../composables/useLlmProviderAuth';
import { useLlmSettingsState } from '../composables/useLlmSettingsState';
import { useNotificationStore } from '../../../stores/notification';
import { useSettingsStore } from '../../../stores/settings';

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
const { providerApiKeys, getKeyPlaceholder, isKeySaving, submitProviderApiKey, removeProviderAuth } =
  useLlmProviderAuth(settingsStore, notificationStore, activeModelGroup);
const {
  isCustomFormOpen,
  pendingModelProvider,
  customProvider,
  providerModelDraft,
  customModelDraft,
  fetchedCustomModels,
  addableFetchedModels,
  fetchCustomModels,
  fetchCustomModelsForProvider,
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
  <section class="llm-settings settings-section" aria-labelledby="settings-provider-title">
    <div class="settings-section-heading">
      <h3 id="settings-provider-title" class="settings-section-title">模型服务</h3>
      <button
        class="settings-secondary-button"
        type="button"
        :disabled="settingsStore.isModelsLoading"
        @click="settingsStore.loadModels()"
      >
        刷新模型
      </button>
    </div>
    <p class="settings-section-description">
      管理内置模型与自定义模型。自定义模型的服务地址、模型 ID 与模型 Key 会保存在模型配置中；内置模型的 Key
      会保存在凭据配置中。
    </p>

    <div class="settings-summary-card">
      <span class="settings-path-label">当前默认模型</span>
      <strong>{{ defaultModelLabel }}</strong>
    </div>

    <LlmCustomProviderForm
      v-model:open="isCustomFormOpen"
      :provider="customProvider"
      :draft="providerModelDraft"
      :fetched-models="fetchedCustomModels"
      :is-fetching="settingsStore.isFetchingCustomModels"
      :is-loading="settingsStore.isModelsLoading"
      :can-fetch="
        Boolean(customProvider.baseUrl && customProvider.apiKey) && customProvider.api !== 'anthropic-messages'
      "
      :can-submit="Boolean(providerModelDraft.modelId)"
      @fetch="fetchCustomModels"
      @submit="submitCustomProvider"
    />

    <LlmModelGroupTabs
      :active-group="activeModelGroup"
      :builtin-count="builtinCount"
      :custom-count="customCount"
      @select="setModelGroup"
    />

    <div v-if="settingsStore.isModelsLoading" class="settings-empty-card">正在读取模型清单...</div>
    <div v-else-if="!providerViews.length" class="settings-empty-card">
      {{ activeModelGroup === 'custom' ? '暂无自定义模型。展开上方表单添加模型。' : '暂无内置模型。请稍后刷新重试。' }}
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
        :is-key-saving="isKeySaving(selectedProvider.provider)"
        :key-placeholder="getKeyPlaceholder(selectedProvider)"
        :custom-model-draft="customModelDraft"
        :addable-fetched-models="addableFetchedModels"
        :pending-model-provider="pendingModelProvider"
        :is-fetching-custom-models="settingsStore.isFetchingCustomModels"
        :is-models-loading="settingsStore.isModelsLoading"
        :models="selectedProviderModels"
        @update-api-key="providerApiKeys[selectedProvider.provider] = $event"
        @submit-api-key="submitProviderApiKey(selectedProvider.provider)"
        @remove-provider-auth="removeProviderAuth(selectedProvider.provider)"
        @fetch-custom-models="fetchCustomModelsForProvider"
        @submit-custom-model="submitCustomModelToProvider"
        @set-default="setDefaultModel"
        @toggle-image-input="toggleImageInput"
        @remove-custom-model="removeCustomModel"
      />
    </div>
  </section>
</template>

<style lang="scss">
@use '../styles/llm-settings';
</style>
