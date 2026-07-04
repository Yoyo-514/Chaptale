<script setup lang="ts">
import type { ChaptaleCustomProviderApi, FetchedCustomProviderModel } from '@chaptale/ipc-contract';
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui';

import CustomModelDraftForm from './CustomModelDraftForm.vue';
import type { CustomModelDraft } from '../utils/custom-model-draft';

export type CustomProviderFormState = {
  provider: string;
  providerName: string;
  baseUrl: string;
  api: ChaptaleCustomProviderApi;
  apiKey: string;
};

const props = defineProps<{
  open: boolean;
  provider: CustomProviderFormState;
  draft: CustomModelDraft;
  fetchedModels: FetchedCustomProviderModel[];
  isFetching: boolean;
  isLoading: boolean;
  canFetch: boolean;
  canSubmit: boolean;
}>();

const emit = defineEmits<{
  'update:open': [open: boolean];
  fetch: [];
  submit: [];
}>();
</script>

<template>
  <CollapsibleRoot :open="props.open" class="settings-custom-provider" @update:open="emit('update:open', $event)">
    <CollapsibleTrigger class="settings-collapsible-trigger">
      <span>
        <strong>自定义供应商</strong>
        <small>添加 Ollama、LM Studio、vLLM 或兼容 OpenAI API 的服务</small>
      </span>
      <span class="settings-trigger-icon i-mingcute-down-line" :class="{ 'is-open': props.open }" aria-hidden="true" />
    </CollapsibleTrigger>

    <CollapsibleContent>
      <form class="settings-form" @submit.prevent="emit('submit')">
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

        <div class="settings-form-divider">首个模型（Context Window 与图像能力按模型配置）</div>

        <CustomModelDraftForm
          :draft="props.draft"
          :fetched-models="props.fetchedModels"
          :is-fetching="props.isFetching"
          :can-fetch="props.canFetch"
          fetch-disabled-reason="需要先填写 Base URL 和模型 Key（Anthropic 不支持拉取）"
          @fetch="emit('fetch')"
        />

        <div class="settings-actions">
          <button class="settings-primary-button" type="submit" :disabled="props.isLoading || !props.canSubmit">
            添加供应商
          </button>
        </div>
      </form>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>
