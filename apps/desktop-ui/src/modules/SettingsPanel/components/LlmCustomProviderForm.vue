<script setup lang="ts">
import type { ChaptaleCustomProviderApi, FetchedCustomProviderModel } from '@chaptale/ipc-contract';

import AppButton from '@/components/AppButton/AppButton.vue';
import AppDialog from '@/components/AppDialog/AppDialog.vue';
import AppScrollArea from '@/components/AppScrollArea/AppScrollArea.vue';
import AppSelect from '@/components/AppSelect/AppSelect.vue';
import AppSelectItem from '@/components/AppSelect/AppSelectItem.vue';
import type { CustomModelDraft } from '../utils/custom-model-draft';
import CustomModelDraftForm from './CustomModelDraftForm.vue';

export type CustomProviderFormState = {
  provider: string;
  providerName: string;
  baseUrl: string;
  api: ChaptaleCustomProviderApi;
  apiKey: string;
};

type StagedCustomModel = {
  modelId: string;
  modelName?: string;
  input: ('text' | 'image')[];
  contextWindow?: number;
};

const props = defineProps<{
  open: boolean;
  provider: CustomProviderFormState;
  draft: CustomModelDraft;
  stagedModels: StagedCustomModel[];
  fetchedModels: FetchedCustomProviderModel[];
  isFetching: boolean;
  isLoading: boolean;
  canFetch: boolean;
  canStageModel: boolean;
  canSubmit: boolean;
}>();

const emit = defineEmits<{
  'update:open': [open: boolean];
  fetch: [];
  stageModel: [];
  removeStagedModel: [modelId: string];
  submit: [];
}>();

const apiOptions: Array<{ value: ChaptaleCustomProviderApi; label: string }> = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' }
];

function getApiLabel(api: ChaptaleCustomProviderApi) {
  return apiOptions.find(option => option.value === api)?.label ?? api;
}
</script>

<template>
  <AppDialog
    :open="props.open"
    title="添加自定义供应商"
    description="配置兼容 OpenAI、Anthropic、Google 或本地网关的模型服务，并可一次添加多个模型。"
    content-size="lg"
    @update:open="emit('update:open', $event)"
  >
    <template #default="{ close }">
      <AppScrollArea class="settings-dialog-form-scroll">
        <form class="settings-dialog-form" @submit.prevent="emit('submit')">
          <section class="settings-dialog-form-section">
            <h4 class="settings-subtitle">供应商信息</h4>
            <div class="settings-form-grid">
              <label class="settings-field">
                <span>供应商 ID</span>
                <input
                  v-model="props.provider.provider"
                  class="settings-input"
                  placeholder="deepseek-custom"
                  autocomplete="off"
                />
              </label>
              <label class="settings-field">
                <span>显示名称</span>
                <input
                  v-model="props.provider.providerName"
                  class="settings-input"
                  placeholder="DeepSeek Custom"
                  autocomplete="off"
                />
              </label>
              <label class="settings-field">
                <span>API 类型</span>
                <AppSelect
                  :model-value="props.provider.api"
                  trigger-class="settings-dropdown-trigger"
                  content-size="md"
                  @update:model-value="props.provider.api = $event as ChaptaleCustomProviderApi"
                >
                  <template #trigger="{ triggerClass, disabled, dataDisabled }">
                    <button :class="triggerClass" type="button" :disabled="disabled" :data-disabled="dataDisabled">
                      <span>{{ getApiLabel(props.provider.api) }}</span>
                      <span class="i-mingcute-down-line settings-select-icon" aria-hidden="true" />
                    </button>
                  </template>
                  <AppSelectItem v-for="option in apiOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </AppSelectItem>
                </AppSelect>
              </label>
              <label class="settings-field">
                <span>模型 Key</span>
                <input
                  v-model="props.provider.apiKey"
                  class="settings-input"
                  type="password"
                  placeholder="可选；拉取模型时需要"
                  autocomplete="off"
                />
              </label>
              <label class="settings-field is-wide">
                <span>Base URL</span>
                <input
                  v-model="props.provider.baseUrl"
                  class="settings-input"
                  placeholder="https://api.example.com/v1"
                  autocomplete="off"
                />
              </label>
            </div>
          </section>

          <section class="settings-dialog-form-section">
            <div class="settings-provider-head">
              <h4 class="settings-subtitle">模型列表</h4>
              <span class="settings-path-label">可先拉取模型，也可手动输入后加入待添加列表</span>
            </div>
            <CustomModelDraftForm
              :draft="props.draft"
              :fetched-models="props.fetchedModels"
              :is-fetching="props.isFetching"
              :can-fetch="props.canFetch"
              fetch-disabled-reason="需要先填写 Base URL 和模型 Key（Anthropic 不支持拉取）"
              @fetch="emit('fetch')"
            />
            <div class="settings-actions compact">
              <AppButton type="button" :disabled="!props.canStageModel" @click="emit('stageModel')">
                加入待添加列表
              </AppButton>
            </div>

            <div v-if="props.stagedModels.length" class="settings-staged-model-list">
              <article v-for="model in props.stagedModels" :key="model.modelId" class="settings-staged-model-row">
                <div class="settings-model-copy">
                  <strong>{{ model.modelName || model.modelId }}</strong>
                  <code>{{ model.modelId }}</code>
                  <span
                    >{{ model.input.includes('image') ? 'Text + Image' : 'Text' }} ·
                    {{ model.contextWindow?.toLocaleString() ?? '默认' }} tokens</span
                  >
                </div>
                <AppButton
                  icon
                  variant="danger"
                  type="button"
                  aria-label="移除待添加模型"
                  @click="emit('removeStagedModel', model.modelId)"
                >
                  <span class="i-mingcute-delete-2-line size-4" aria-hidden="true" />
                </AppButton>
              </article>
            </div>
            <div v-else class="settings-empty-card">还没有待添加模型；可以稍后在供应商详情中继续添加。</div>
          </section>

          <div class="settings-dialog-form-actions">
            <AppButton type="button" @click="close">取消</AppButton>
            <AppButton variant="primary" type="submit" :disabled="props.isLoading || !props.canSubmit">
              添加供应商
            </AppButton>
          </div>
        </form>
      </AppScrollArea>
    </template>
  </AppDialog>
</template>

<style scoped lang="scss">
@use '../styles/dialog';
@use '../styles/controls';
</style>
