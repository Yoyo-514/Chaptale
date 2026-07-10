<script setup lang="ts">
import type { FetchedCustomProviderModel } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppFormField, AppFormGrid } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import type { CustomModelDraft } from '../utils/custom-model-draft';

/**
 * 自定义模型草稿表单（供“添加供应商”与“已有供应商添加模型”复用）。
 *
 * - 拉取模型是辅助能力：可从下拉选择，也可以手动输入模型 ID；
 * - Context Window 与图像输入按“每个模型”配置。
 */
type FetchedModelOption = FetchedCustomProviderModel & {
  isAdded?: boolean;
};

const props = defineProps<{
  draft: CustomModelDraft;
  fetchedModels: FetchedModelOption[];
  isFetching: boolean;
  canFetch: boolean;
  fetchDisabledReason?: string;
}>();

const emit = defineEmits<{
  fetch: [];
}>();

function selectModel(model: FetchedModelOption) {
  if (model.isAdded) {
    return;
  }

  props.draft.modelId = model.id;
  props.draft.modelName = model.name || model.id;
}

function selectFetchedModel(modelId: string) {
  const model = props.fetchedModels.find(item => item.id === modelId);

  if (!model) {
    return;
  }

  selectModel(model);
}
</script>

<template>
  <div class="model-draft-fields">
    <div class="model-draft-fetch-row">
      <AppButton
        type="button"
        :disabled="props.isFetching || !props.canFetch"
        :title="!props.canFetch ? props.fetchDisabledReason : undefined"
        @click="emit('fetch')"
      >
        {{ props.isFetching ? '拉取中...' : '拉取模型' }}
      </AppButton>
      <AppSelect
        :model-value="props.draft.modelId"
        size="sm"
        variant="default"
        :disabled="props.fetchedModels.length === 0"
        @update:model-value="selectFetchedModel"
      >
        <template #trigger="{ triggerClass, disabled, dataDisabled }">
          <button :class="triggerClass" type="button" :disabled="disabled" :data-disabled="dataDisabled">
            {{ props.fetchedModels.length ? '选择拉取到的模型' : '未拉取到模型，可手动输入' }}
          </button>
        </template>
        <AppSelectItem v-for="model in props.fetchedModels" :key="model.id" :value="model.id" :disabled="model.isAdded">
          <span class="settings-dropdown-item-title">
            <span>{{ model.name || model.id }}</span>
            <small v-if="model.isAdded" class="settings-dropdown-item-badge">已添加</small>
          </span>
          <code class="settings-dropdown-item-code">{{ model.id }}</code>
        </AppSelectItem>
      </AppSelect>
    </div>

    <AppFormGrid :columns="2">
      <AppFormField label="模型 ID">
        <template #default="{ controlAttrs }">
          <AppInput
            v-bind="controlAttrs"
            v-model="props.draft.modelId"
            placeholder="可手动输入，或从上方选择"
            autocomplete="off"
          />
        </template>
      </AppFormField>

      <AppFormField label="模型名称">
        <template #default="{ controlAttrs }">
          <AppInput
            v-bind="controlAttrs"
            v-model="props.draft.modelName"
            placeholder="可选，默认同模型 ID"
            autocomplete="off"
          />
        </template>
      </AppFormField>

      <AppFormField label="Context Window">
        <template #default="{ controlAttrs }">
          <AppInput
            v-bind="controlAttrs"
            v-model="props.draft.contextWindow"
            inputmode="numeric"
            placeholder="128000"
            autocomplete="off"
          />
        </template>
      </AppFormField>

      <AppFormField class="model-draft-check">
        <template #default="{ controlAttrs }">
          <label :for="controlAttrs.id" class="model-draft-check-label">
            <AppCheckbox
              v-bind="controlAttrs"
              :model-value="props.draft.supportsImageInput"
              @update:model-value="props.draft.supportsImageInput = $event === true"
            />
            <span>支持图像输入</span>
          </label>
        </template>
      </AppFormField>
    </AppFormGrid>
  </div>
</template>

<style lang="scss">
.model-draft-fields {
  @apply flex flex-col gap-2;
}

.model-draft-fetch-row {
  @apply grid grid-cols-[auto_minmax(0,1fr)] gap-2;
}

.model-draft-check {
  @apply self-end pb-1.5;
}

.model-draft-check-label {
  @apply flex items-center gap-2 text-xs leading-5;

  color: var(--foreground);
}
</style>
