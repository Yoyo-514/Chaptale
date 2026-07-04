<script setup lang="ts">
import type { ChaptaleCustomProviderApi, ChaptaleModelInfo, ChaptaleProviderInfo } from '@chaptale/ipc-contract';
import {
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport
} from 'reka-ui';
import { computed, reactive, ref, watch } from 'vue';

import { useNotificationStore } from '../../../stores/notification';
import { useSettingsStore } from '../../../stores/settings';
import { createCustomModelDraft, draftToInput, parseContextWindow, resetCustomModelDraft } from './custom-model-draft';
import CustomModelDraftForm from './CustomModelDraftForm.vue';

type ModelGroup = 'builtin' | 'custom';

type ProviderView = ChaptaleProviderInfo & {
  modelCount: number;
};

const notificationStore = useNotificationStore();
const settingsStore = useSettingsStore();
const selectedProviderId = ref('');
const activeModelGroup = ref<ModelGroup>('builtin');
const isCustomFormOpen = ref(false);
const pendingKeyProvider = ref('');
const pendingModelProvider = ref('');
const providerApiKeys = reactive<Record<string, string>>({});
const customProvider = reactive({
  provider: '',
  providerName: '',
  baseUrl: '',
  api: 'openai-completions' as ChaptaleCustomProviderApi,
  apiKey: ''
});
// 新建供应商时的首个模型草稿（Context Window / 图像输入按模型配置）
const providerModelDraft = reactive(createCustomModelDraft());
// 已有自定义供应商“添加模型”的草稿
const customModelDraft = reactive(createCustomModelDraft());

const modelState = computed(() => settingsStore.models);
const models = computed(() => modelState.value?.models ?? []);
const visibleModels = computed(() =>
  models.value.filter(model => model.isCustom === (activeModelGroup.value === 'custom'))
);
const providerViews = computed(() => createProviderViews(visibleModels.value, modelState.value?.providers ?? []));
const selectedProvider = computed(
  () => providerViews.value.find(provider => provider.provider === selectedProviderId.value) ?? providerViews.value[0]
);
const selectedProviderModels = computed(() =>
  selectedProvider.value ? visibleModels.value.filter(model => model.provider === selectedProvider.value?.provider) : []
);
const fetchedCustomModels = computed(() => settingsStore.fetchedCustomModels);
const addableFetchedModels = computed(() => {
  const existingIds = new Set(selectedProviderModels.value.map(model => model.id));
  return fetchedCustomModels.value.filter(model => !existingIds.has(model.id));
});
const builtinCount = computed(() => models.value.filter(model => !model.isCustom).length);
const customCount = computed(() => models.value.filter(model => model.isCustom).length);
const defaultModelLabel = computed(() => {
  const defaultModel = modelState.value?.defaultModel;

  if (!defaultModel) {
    return '未选择';
  }

  const model = models.value.find(item => item.provider === defaultModel.provider && item.id === defaultModel.modelId);
  return model ? `${model.providerName} / ${model.name}` : `${defaultModel.provider}/${defaultModel.modelId}`;
});

watch(
  providerViews,
  nextProviders => {
    if (!nextProviders.length) {
      selectedProviderId.value = '';
      return;
    }

    if (!nextProviders.some(provider => provider.provider === selectedProviderId.value)) {
      selectedProviderId.value = nextProviders[0].provider;
    }
  },
  { immediate: true }
);

function setModelGroup(group: ModelGroup) {
  activeModelGroup.value = group;
}

function selectProvider(provider: ChaptaleProviderInfo) {
  selectedProviderId.value = provider.provider;
}

function getKeyPlaceholder(provider?: ChaptaleProviderInfo) {
  if (provider?.authConfigured) {
    return '••••••••••••';
  }

  return activeModelGroup.value === 'custom' ? '输入模型 Key' : '输入 API Key';
}

function isKeySaving(provider?: string) {
  return pendingKeyProvider.value === provider;
}

async function submitProviderApiKey(provider: string) {
  const apiKey = providerApiKeys[provider]?.trim();

  if (!apiKey) {
    notificationStore.error('API Key 不能为空');
    return;
  }

  pendingKeyProvider.value = provider;

  try {
    const succeeded =
      activeModelGroup.value === 'custom'
        ? await settingsStore.setCustomProviderApiKey(provider, apiKey)
        : await settingsStore.setProviderApiKey(provider, apiKey);

    if (succeeded) {
      providerApiKeys[provider] = '';
    }
  } finally {
    pendingKeyProvider.value = '';
  }
}

async function removeProviderAuth(provider: string) {
  pendingKeyProvider.value = provider;

  try {
    if (activeModelGroup.value === 'custom') {
      await settingsStore.removeCustomProviderApiKey(provider);
      return;
    }

    await settingsStore.removeProviderAuth(provider);
  } finally {
    pendingKeyProvider.value = '';
  }
}

async function removeCustomModel(provider: string, modelId: string) {
  await settingsStore.removeCustomModel(provider, modelId);
}

async function setDefaultModel(provider: string, modelId: string) {
  await settingsStore.setDefaultModel(provider, modelId);
}

async function toggleImageInput(model: ChaptaleModelInfo, checked: boolean) {
  const input = checked ? ['text' as const, 'image' as const] : ['text' as const];
  await settingsStore.updateCustomModelInput(model.provider, model.id, input);
}

async function fetchCustomModels() {
  await settingsStore.fetchCustomProviderModels({
    baseUrl: customProvider.baseUrl,
    api: customProvider.api,
    apiKey: customProvider.apiKey || undefined
  });
}

async function fetchCustomModelsForProvider(provider: string) {
  pendingModelProvider.value = provider;

  try {
    await settingsStore.fetchCustomProviderModels({ provider });
  } finally {
    pendingModelProvider.value = '';
  }
}

async function submitCustomModelToProvider(provider: string) {
  const succeeded = await settingsStore.addCustomModel({
    provider,
    modelId: customModelDraft.modelId,
    modelName: customModelDraft.modelName || undefined,
    input: draftToInput(customModelDraft),
    contextWindow: parseContextWindow(customModelDraft)
  });

  if (succeeded) {
    notificationStore.success('模型已添加');
    resetCustomModelDraft(customModelDraft);
  }
}

async function submitCustomProvider() {
  const succeeded = await settingsStore.addCustomProvider({
    provider: customProvider.provider,
    providerName: customProvider.providerName,
    baseUrl: customProvider.baseUrl,
    api: customProvider.api,
    modelId: providerModelDraft.modelId,
    modelName: providerModelDraft.modelName || undefined,
    apiKey: customProvider.apiKey || undefined,
    input: draftToInput(providerModelDraft),
    contextWindow: parseContextWindow(providerModelDraft)
  });

  if (succeeded) {
    notificationStore.success('供应商已添加');
    activeModelGroup.value = 'custom';
    selectedProviderId.value = customProvider.provider.trim();
    customProvider.provider = '';
    customProvider.providerName = '';
    customProvider.baseUrl = '';
    customProvider.api = 'openai-completions';
    customProvider.apiKey = '';
    resetCustomModelDraft(providerModelDraft);
    settingsStore.clearFetchedCustomModels();
    isCustomFormOpen.value = false;
  }
}

function createProviderViews(models: ChaptaleModelInfo[], providers: ChaptaleProviderInfo[]): ProviderView[] {
  const providerMap = new Map(providers.map(provider => [provider.provider, provider]));
  const countMap = new Map<string, number>();

  for (const model of models) {
    countMap.set(model.provider, (countMap.get(model.provider) ?? 0) + 1);
  }

  return [...countMap.entries()]
    .map(([provider, modelCount]) => {
      const baseProvider = providerMap.get(provider);
      return {
        provider,
        providerName: baseProvider?.providerName ?? provider,
        authConfigured: Boolean(baseProvider?.authConfigured),
        authSource: baseProvider?.authSource,
        modelCount
      } satisfies ProviderView;
    })
    .toSorted((left, right) => {
      if (left.authConfigured !== right.authConfigured) {
        return left.authConfigured ? -1 : 1;
      }

      return left.providerName.localeCompare(right.providerName);
    });
}
</script>

<template>
  <section class="settings-section" aria-labelledby="settings-provider-title">
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

    <CollapsibleRoot v-model:open="isCustomFormOpen" class="settings-custom-provider">
      <CollapsibleTrigger class="settings-collapsible-trigger">
        <span>
          <strong>自定义供应商</strong>
          <small>添加 Ollama、LM Studio、vLLM 或兼容 OpenAI API 的服务</small>
        </span>
        <span
          class="settings-trigger-icon i-mingcute-down-line"
          :class="{ 'is-open': isCustomFormOpen }"
          aria-hidden="true"
        />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <form class="settings-form" @submit.prevent="submitCustomProvider">
          <div class="settings-form-grid">
            <label class="settings-field">
              <span>供应商 ID</span>
              <input
                v-model="customProvider.provider"
                class="settings-input"
                placeholder="deepseek-custom"
                autocomplete="off"
              />
            </label>
            <label class="settings-field">
              <span>显示名称</span>
              <input
                v-model="customProvider.providerName"
                class="settings-input"
                placeholder="DeepSeek Custom"
                autocomplete="off"
              />
            </label>
            <label class="settings-field">
              <span>API 类型</span>
              <select v-model="customProvider.api" class="settings-input">
                <option value="openai-completions">OpenAI Chat Completions</option>
                <option value="openai-responses">OpenAI Responses</option>
                <option value="anthropic-messages">Anthropic Messages</option>
                <option value="google-generative-ai">Google Generative AI</option>
              </select>
            </label>
            <label class="settings-field">
              <span>模型 Key</span>
              <input
                v-model="customProvider.apiKey"
                class="settings-input"
                type="password"
                placeholder="可选；拉取模型时需要"
                autocomplete="off"
              />
            </label>
            <label class="settings-field is-wide">
              <span>Base URL</span>
              <input
                v-model="customProvider.baseUrl"
                class="settings-input"
                placeholder="https://api.example.com/v1"
                autocomplete="off"
              />
            </label>
          </div>

          <div class="settings-form-divider">首个模型（Context Window 与图像能力按模型配置）</div>

          <CustomModelDraftForm
            :draft="providerModelDraft"
            :fetched-models="fetchedCustomModels"
            :is-fetching="settingsStore.isFetchingCustomModels"
            :can-fetch="
              Boolean(customProvider.baseUrl && customProvider.apiKey) && customProvider.api !== 'anthropic-messages'
            "
            fetch-disabled-reason="需要先填写 Base URL 和模型 Key（Anthropic 不支持拉取）"
            @fetch="fetchCustomModels"
          />

          <div class="settings-actions">
            <button
              class="settings-primary-button"
              type="submit"
              :disabled="settingsStore.isModelsLoading || !providerModelDraft.modelId"
            >
              添加供应商
            </button>
          </div>
        </form>
      </CollapsibleContent>
    </CollapsibleRoot>

    <div class="settings-group-tabs" role="tablist" aria-label="模型来源">
      <button
        class="settings-group-tab"
        :class="{ 'is-active': activeModelGroup === 'builtin' }"
        type="button"
        @click="setModelGroup('builtin')"
      >
        内置模型 <span>{{ builtinCount }}</span>
      </button>
      <button
        class="settings-group-tab"
        :class="{ 'is-active': activeModelGroup === 'custom' }"
        type="button"
        @click="setModelGroup('custom')"
      >
        自定义模型 <span>{{ customCount }}</span>
      </button>
    </div>

    <div v-if="settingsStore.isModelsLoading" class="settings-empty-card">正在读取模型清单...</div>
    <div v-else-if="!providerViews.length" class="settings-empty-card">
      {{ activeModelGroup === 'custom' ? '暂无自定义模型。展开上方表单添加模型。' : '暂无内置模型。请稍后刷新重试。' }}
    </div>
    <div v-else class="settings-model-layout">
      <ScrollAreaRoot class="settings-scroll-root">
        <ScrollAreaViewport class="settings-scroll-viewport">
          <aside class="settings-provider-list" aria-label="供应商列表">
            <button
              v-for="provider in providerViews"
              :key="provider.provider"
              class="settings-provider-card"
              :class="{ 'is-active': selectedProvider?.provider === provider.provider }"
              type="button"
              @click="selectProvider(provider)"
            >
              <span class="settings-provider-name">{{ provider.providerName }}</span>
              <span class="settings-provider-meta">
                {{ provider.modelCount }} 个模型 · {{ provider.authConfigured ? '已配置凭据' : '未配置凭据' }}
              </span>
            </button>
          </aside>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar class="settings-scrollbar" orientation="vertical">
          <ScrollAreaThumb class="settings-scrollbar-thumb" />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>

      <ScrollAreaRoot v-if="selectedProvider" class="settings-scroll-root">
        <ScrollAreaViewport class="settings-scroll-viewport">
          <div class="settings-provider-detail">
            <div class="settings-provider-head">
              <div>
                <h4 class="settings-subtitle">{{ selectedProvider.providerName }}</h4>
                <p class="settings-section-description">
                  供应商 ID：<code>{{ selectedProvider.provider }}</code>
                </p>
              </div>
              <span class="settings-pill">{{ selectedProvider.authConfigured ? '已配置 Key' : '未配置 Key' }}</span>
            </div>

            <div class="settings-auth-panel">
              <label class="settings-key-field">
                <span>{{ activeModelGroup === 'custom' ? '模型 Key' : 'API Key' }}</span>
                <input
                  v-model="providerApiKeys[selectedProvider.provider]"
                  class="settings-input"
                  type="password"
                  autocomplete="off"
                  :placeholder="getKeyPlaceholder(selectedProvider)"
                  :disabled="isKeySaving(selectedProvider.provider)"
                  @keydown.enter.prevent="submitProviderApiKey(selectedProvider.provider)"
                />
              </label>
              <div class="settings-auth-actions">
                <button
                  class="settings-primary-button"
                  type="button"
                  :disabled="isKeySaving(selectedProvider.provider)"
                  @click="submitProviderApiKey(selectedProvider.provider)"
                >
                  {{
                    isKeySaving(selectedProvider.provider)
                      ? '保存中...'
                      : activeModelGroup === 'custom'
                        ? '保存模型 Key'
                        : '保存凭据'
                  }}
                </button>
                <button
                  class="settings-secondary-button"
                  type="button"
                  :disabled="
                    isKeySaving(selectedProvider.provider) ||
                    (activeModelGroup !== 'custom' && !selectedProvider.authConfigured)
                  "
                  @click="removeProviderAuth(selectedProvider.provider)"
                >
                  {{ activeModelGroup === 'custom' ? '移除模型 Key' : '移除凭据' }}
                </button>
              </div>
            </div>

            <div v-if="activeModelGroup === 'custom'" class="settings-add-model-panel">
              <span class="settings-path-label">添加模型</span>
              <CustomModelDraftForm
                :draft="customModelDraft"
                :fetched-models="addableFetchedModels"
                :is-fetching="pendingModelProvider === selectedProvider.provider"
                :can-fetch="selectedProvider.authConfigured && !settingsStore.isFetchingCustomModels"
                fetch-disabled-reason="需要先保存模型 Key 才能拉取模型"
                @fetch="fetchCustomModelsForProvider(selectedProvider.provider)"
              />
              <div class="settings-actions">
                <button
                  class="settings-primary-button"
                  type="button"
                  :disabled="!customModelDraft.modelId"
                  @click="submitCustomModelToProvider(selectedProvider.provider)"
                >
                  添加模型
                </button>
              </div>
            </div>

            <div class="settings-model-list">
              <article
                v-for="model in selectedProviderModels"
                :key="model.id"
                class="settings-model-row"
                :class="{ 'is-default': model.isDefault }"
                role="button"
                tabindex="0"
                @click="setDefaultModel(model.provider, model.id)"
                @keydown.enter.prevent="setDefaultModel(model.provider, model.id)"
                @keydown.space.prevent="setDefaultModel(model.provider, model.id)"
              >
                <div class="settings-model-copy">
                  <span class="settings-model-title-line">
                    <strong>{{ model.name }}</strong>
                    <span v-if="model.isDefault" class="settings-default-badge">默认</span>
                  </span>
                  <code>{{ model.id }}</code>
                  <span class="settings-model-info">
                    {{ model.reasoning ? 'Reasoning' : 'Standard' }}
                    · {{ model.input.includes('image') ? 'Text + Image' : 'Text' }} ·
                    {{ model.contextWindow.toLocaleString() }} tokens
                  </span>
                </div>
                <div class="settings-model-actions" @click.stop>
                  <label v-if="model.isCustom" class="settings-inline-check">
                    <input
                      type="checkbox"
                      :checked="model.input.includes('image')"
                      :disabled="settingsStore.isModelsLoading"
                      @change="toggleImageInput(model, ($event.target as HTMLInputElement).checked)"
                    />
                    <span>图像</span>
                  </label>
                  <button
                    v-if="model.isCustom"
                    class="settings-danger-icon-button"
                    type="button"
                    :disabled="settingsStore.isModelsLoading"
                    aria-label="删除自定义模型"
                    @click="removeCustomModel(model.provider, model.id)"
                  >
                    <span class="i-mingcute-delete-2-line size-4" aria-hidden="true" />
                  </button>
                </div>
              </article>
            </div>
          </div>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar class="settings-scrollbar" orientation="vertical">
          <ScrollAreaThumb class="settings-scrollbar-thumb" />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>
    </div>
  </section>
</template>

<style scoped lang="scss">
.settings-section {
  @apply p-2;

  background: var(--surface-acrylic-subtle);
}

.settings-section-heading,
.settings-provider-head,
.settings-collapsible-trigger {
  @apply flex items-start justify-between gap-3;
}

.settings-section-title,
.settings-subtitle {
  @apply m-0 text-sm font-semibold;
}

.settings-section-description {
  @apply mt-1 mb-3 text-xs leading-5;

  color: var(--muted-foreground);
}

.settings-section-description code,
.settings-checkbox-field code,
.settings-model-copy code {
  @apply break-all text-xs;

  color: var(--foreground);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
}

.settings-pill,
.settings-summary-card,
.settings-empty-card,
.settings-model-row,
.settings-custom-provider,
.settings-add-model-panel {
  @apply relative border;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
}

.settings-pill {
  @apply shrink-0 px-2 py-1 text-xs;
}

.settings-summary-card {
  @apply mb-3 flex items-center justify-between gap-3 px-3 py-2 text-xs;
}

.settings-path-label,
.settings-provider-meta,
.settings-model-copy span,
.settings-collapsible-trigger small {
  @apply text-xs leading-4;

  color: var(--muted-foreground);
}

.settings-custom-provider {
  @apply mb-3 overflow-hidden;
}

.settings-collapsible-trigger {
  @apply w-full border-0 px-3 py-2 text-left outline-none transition-colors duration-150;

  background: transparent;
  color: var(--foreground);
}

.settings-collapsible-trigger:hover {
  background: var(--surface-muted);
}

.settings-collapsible-trigger strong,
.settings-collapsible-trigger small {
  @apply block;
}

.settings-trigger-icon {
  @apply mt-0.5 shrink-0 transition-transform duration-150;
}

.settings-trigger-icon.is-open {
  transform: rotate(180deg);
}

.settings-form {
  @apply flex flex-col gap-2 border-t p-3;

  border-color: var(--border-subtle);
}

.settings-form-divider {
  @apply mt-1 border-t pt-2 text-xs font-medium;

  border-color: var(--border-subtle);
  color: var(--muted-foreground);
}

.settings-form-grid {
  @apply grid grid-cols-2 gap-2;
}

.settings-field {
  @apply flex min-w-0 flex-col gap-1 text-xs;

  color: var(--muted-foreground);
}

.settings-field.is-wide,
.settings-checkbox-field.is-wide {
  @apply col-span-2;
}

.settings-dropdown-trigger {
  @apply flex w-full min-w-0 items-center justify-between gap-2 border px-3 py-1.5 text-left text-xs outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60;

  background: var(--input);
  border-color: var(--input-border);
  border-radius: calc(var(--radius) * 0.5);
  color: var(--foreground);
}

:global(.settings-dropdown-content) {
  @apply z-50 flex max-h-[16rem] min-w-64 flex-col gap-1 overflow-y-auto border p-1 shadow-float;

  width: var(--reka-dropdown-menu-trigger-width, var(--radix-dropdown-menu-trigger-width, 24rem));
  background: var(--popover);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
  color: var(--popover-foreground);
}

:global(.settings-dropdown-item) {
  @apply flex cursor-pointer flex-col gap-0.5 px-2 py-1.5 text-xs outline-none;

  border-radius: calc(var(--radius) * 0.4);
}

:global(.settings-dropdown-item[data-highlighted]) {
  background: var(--surface-muted);
}

:global(.settings-dropdown-item code) {
  @apply break-all text-[0.68rem];

  color: var(--muted-foreground);
}

.settings-checkbox-field {
  @apply flex items-start gap-2 text-xs leading-5;

  color: var(--foreground);
}

.settings-checkbox-field input {
  @apply mt-1 size-3.5 shrink-0;

  accent-color: var(--primary-solid);
}

.settings-checkbox-field small {
  @apply mt-0.5 block leading-4;

  color: var(--muted-foreground);
}

.settings-group-tabs {
  @apply mb-3 grid grid-cols-2 gap-2;
}

.settings-group-tab {
  @apply border px-3 py-2 text-xs font-medium outline-none transition-colors duration-150;

  background: var(--surface-muted);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
  color: var(--foreground);
}

.settings-group-tab span {
  color: var(--muted-foreground);
}

.settings-group-tab:hover,
.settings-group-tab.is-active {
  background: var(--secondary);
  color: var(--secondary-foreground);
}

.settings-empty-card {
  @apply px-3 py-2 text-xs leading-5;

  color: var(--muted-foreground);
}

.settings-model-layout {
  @apply grid min-h-[18rem] max-h-[24rem] grid-cols-[13rem_minmax(0,1fr)] gap-3 overflow-hidden;
}

.settings-scroll-root {
  @apply min-h-0 max-h-[24rem] overflow-hidden;
}

.settings-scroll-viewport {
  @apply h-full max-h-[24rem] pr-2;
}

.settings-scrollbar {
  @apply flex w-2 touch-none select-none p-0.5;

  background: transparent;
}

.settings-scrollbar-thumb {
  @apply relative flex-1;

  background: var(--border);
  border-radius: calc(var(--radius) * 0.5);
}

.settings-provider-list,
.settings-provider-detail,
.settings-model-list,
.settings-model-copy {
  @apply flex min-w-0 max-h-[24rem] flex-col gap-2;
}

.settings-model-actions {
  @apply absolute top-1 right-2 flex min-w-0 items-center justify-end gap-2;
}

.settings-provider-card {
  @apply flex min-w-0 flex-col border px-2.5 py-2 text-left outline-none transition-colors duration-150;

  background: transparent;
  border-color: transparent;
  border-radius: calc(var(--radius) * 0.5);
  color: var(--foreground);
}

.settings-provider-card:hover,
.settings-provider-card.is-active {
  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
}

.settings-provider-name,
.settings-model-copy strong {
  @apply text-xs font-semibold;
}

.settings-model-title-line {
  @apply flex min-w-0 items-center gap-2;
}

.settings-default-badge {
  @apply shrink-0 border px-1.5 py-0.5 text-[0.65rem] leading-none;

  background: var(--secondary);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.4);
  color: var(--secondary-foreground);
}

.settings-auth-panel,
.settings-add-model-panel {
  @apply mb-3 flex flex-col gap-2 p-1;

  background: var(--surface-acrylic-strong);
}

.settings-add-model-panel {
  @apply p-2;
}

.settings-key-field {
  @apply flex min-w-0 flex-col gap-1 text-xs;

  color: var(--muted-foreground);
}

.settings-auth-actions {
  @apply flex flex-wrap justify-end gap-2;
}

.settings-input {
  @apply min-w-0 border px-3 py-1.5 text-xs outline-none transition-colors duration-150;

  background: var(--input);
  border-color: var(--input-border);
  border-radius: calc(var(--radius) * 0.5);
  color: var(--foreground);
}

.settings-input::placeholder {
  color: var(--muted-foreground);
}

.settings-actions {
  @apply mt-3 flex flex-wrap justify-end gap-2;
}

.settings-primary-button,
.settings-secondary-button,
.settings-danger-button,
.settings-danger-icon-button {
  @apply border px-3 py-1.5 text-xs font-medium outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60;

  border-radius: calc(var(--radius) * 0.5);
}

.settings-primary-button {
  background: var(--primary-solid);
  border-color: var(--primary-solid);
  color: var(--primary-solid-foreground);
}

.settings-primary-button:hover:not(:disabled) {
  background: var(--primary-solid-hover);
}

.settings-secondary-button {
  background: var(--surface-muted);
  border-color: var(--border-subtle);
  color: var(--foreground);
}

.settings-secondary-button:hover:not(:disabled),
.settings-secondary-button.is-selected {
  background: var(--secondary);
  color: var(--secondary-foreground);
}

.settings-danger-button {
  background: var(--destructive-background);
  border-color: var(--destructive);
  color: var(--destructive-background-foreground);
}

.settings-danger-button:hover:not(:disabled),
.settings-danger-icon-button:hover:not(:disabled) {
  background: var(--destructive);
  color: var(--destructive-foreground);
}

.settings-danger-icon-button {
  @apply flex-center size-7 p-0;

  background: var(--destructive-background);
  border-color: var(--destructive);
  color: var(--destructive-background-foreground);
}

.settings-model-list {
  @apply gap-1;
}

.settings-model-row {
  @apply grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-2.5 py-1.5 outline-none transition-colors duration-150;
}

.settings-model-row:hover,
.settings-model-row.is-default {
  background: var(--surface-muted);
}

.settings-model-info {
  @apply text-xs leading-4;

  color: var(--muted-foreground);
}

.settings-inline-check {
  @apply flex items-center gap-1.5 text-xs;

  color: var(--foreground);
}

.settings-inline-check input {
  @apply size-3.5;

  accent-color: var(--primary-solid);
}

.settings-primary-button:focus-visible,
.settings-secondary-button:focus-visible,
.settings-provider-card:focus-visible,
.settings-input:focus-visible,
.settings-group-tab:focus-visible,
.settings-collapsible-trigger:focus-visible,
.settings-model-row:focus-visible,
.settings-danger-button:focus-visible,
.settings-danger-icon-button:focus-visible {
  box-shadow: var(--input-focus-shadow);
}
</style>
