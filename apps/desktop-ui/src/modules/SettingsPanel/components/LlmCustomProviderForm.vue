<script setup lang="ts">
import type { ChaptaleCustomProviderApi, FetchedCustomProviderModel } from '@chaptale/ipc-contract';
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui';

import CustomModelDraftForm from './CustomModelDraftForm.vue';
import type { CustomModelDraft } from '../utils/custom-model-draft';

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
</script>

<template>
  <DialogRoot :open="props.open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="settings-dialog-overlay" />
      <DialogContent class="settings-dialog-content settings-provider-dialog">
        <div class="settings-dialog-header">
          <div>
            <DialogTitle class="settings-dialog-title">添加自定义供应商</DialogTitle>
            <DialogDescription class="settings-dialog-description">
              配置兼容 OpenAI、Anthropic、Google 或本地网关的模型服务，并可一次添加多个模型。
            </DialogDescription>
          </div>
          <DialogClose class="settings-dialog-close" aria-label="关闭">
            <span class="i-mingcute-close-line" aria-hidden="true" />
          </DialogClose>
        </div>

        <form class="settings-dialog-body" @submit.prevent="emit('submit')">
          <section class="settings-dialog-section">
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
                <select v-model="props.provider.api" class="settings-input">
                  <option value="openai-completions">OpenAI Chat Completions</option>
                  <option value="openai-responses">OpenAI Responses</option>
                  <option value="anthropic-messages">Anthropic Messages</option>
                  <option value="google-generative-ai">Google Generative AI</option>
                </select>
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

          <section class="settings-dialog-section">
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
              <button
                class="settings-secondary-button"
                type="button"
                :disabled="!props.canStageModel"
                @click="emit('stageModel')"
              >
                加入待添加列表
              </button>
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
                <button
                  class="settings-danger-icon-button"
                  type="button"
                  aria-label="移除待添加模型"
                  @click="emit('removeStagedModel', model.modelId)"
                >
                  <span class="i-mingcute-delete-2-line size-4" aria-hidden="true" />
                </button>
              </article>
            </div>
            <div v-else class="settings-empty-card">还没有待添加模型；可以稍后在供应商详情中继续添加。</div>
          </section>

          <div class="settings-dialog-actions">
            <DialogClose class="settings-secondary-button" type="button">取消</DialogClose>
            <button class="settings-primary-button" type="submit" :disabled="props.isLoading || !props.canSubmit">
              添加供应商
            </button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped lang="scss">
@use '../styles/dialog';
@use '../styles/controls';
</style>
