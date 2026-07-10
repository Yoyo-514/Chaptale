<script setup lang="ts">
import type { ChaptaleCustomProviderApi, FetchedCustomProviderModel } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppForm, AppFormActions, AppFormField, AppFormGrid, AppFormSection } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
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
        <AppForm class="llm-provider-form" @submit="emit('submit')">
          <AppFormSection title="供应商信息">
            <AppFormGrid :columns="2">
              <AppFormField label="供应商 ID">
                <template #default="{ controlAttrs }">
                  <AppInput
                    v-bind="controlAttrs"
                    v-model="props.provider.provider"
                    name="provider"
                    placeholder="deepseek-custom"
                    autocomplete="off"
                  />
                </template>
              </AppFormField>

              <AppFormField label="显示名称">
                <template #default="{ controlAttrs }">
                  <AppInput
                    v-bind="controlAttrs"
                    v-model="props.provider.providerName"
                    name="providerName"
                    placeholder="DeepSeek Custom"
                    autocomplete="off"
                  />
                </template>
              </AppFormField>

              <AppFormField label="API 类型">
                <template #default="{ controlAttrs }">
                  <AppSelect
                    v-bind="controlAttrs"
                    :model-value="props.provider.api"
                    name="api"
                    size="sm"
                    variant="default"
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
                </template>
              </AppFormField>

              <AppFormField label="API Key">
                <template #default="{ controlAttrs }">
                  <AppInput
                    v-bind="controlAttrs"
                    v-model="props.provider.apiKey"
                    name="apiKey"
                    type="password"
                    placeholder="可选；拉取模型时需要"
                    autocomplete="off"
                  />
                </template>
              </AppFormField>

              <AppFormField label="Base URL" span="full">
                <template #default="{ controlAttrs }">
                  <AppInput
                    v-bind="controlAttrs"
                    v-model="props.provider.baseUrl"
                    name="baseUrl"
                    placeholder="https://api.example.com/v1"
                    autocomplete="off"
                  />
                </template>
              </AppFormField>
            </AppFormGrid>
          </AppFormSection>

          <AppFormSection title="模型列表" description="可先拉取模型，也可手动输入后加入待添加列表">
            <CustomModelDraftForm
              :draft="props.draft"
              :fetched-models="props.fetchedModels"
              :is-fetching="props.isFetching"
              :can-fetch="props.canFetch"
              fetch-disabled-reason="需要先填写 Base URL 和 API Key（Anthropic 不支持拉取）"
              @fetch="emit('fetch')"
            />

            <AppFormActions compact>
              <AppButton type="button" :disabled="!props.canStageModel" @click="emit('stageModel')">
                加入待添加列表
              </AppButton>
            </AppFormActions>

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
          </AppFormSection>

          <AppFormActions>
            <AppButton type="button" @click="close">取消</AppButton>
            <AppButton variant="primary" type="submit" :disabled="props.isLoading || !props.canSubmit">
              添加供应商
            </AppButton>
          </AppFormActions>
        </AppForm>
      </AppScrollArea>
    </template>
  </AppDialog>
</template>

<style scoped lang="scss">
@use '../styles/dialog';

.llm-provider-form {
  @apply flex flex-col gap-4;
}

.settings-select-icon {
  @apply shrink-0 text-base transition-transform duration-150;

  color: var(--muted-foreground);
}

.app-select-trigger[data-state='open'] .settings-select-icon {
  transform: rotate(180deg);
}
</style>
