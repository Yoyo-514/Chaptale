<script setup lang="ts">
import type { FetchedCustomProviderModel } from '@chaptale/ipc-contract';

import AppButton from '@/components/AppButton/AppButton.vue';
import AppCheckbox from '@/components/AppCheckbox/AppCheckbox.vue';
import AppSelect from '@/components/AppSelect/AppSelect.vue';
import AppSelectItem from '@/components/AppSelect/AppSelectItem.vue';
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
        :disabled="isFetching || !canFetch"
        :title="!canFetch ? fetchDisabledReason : undefined"
        @click="emit('fetch')"
      >
        {{ isFetching ? '拉取中...' : '拉取模型' }}
      </AppButton>
      <AppSelect
        :model-value="draft.modelId"
        trigger-class="settings-dropdown-trigger"
        :disabled="fetchedModels.length === 0"
        @update:model-value="selectFetchedModel"
      >
        <template #trigger="{ triggerClass, disabled, dataDisabled }">
          <button :class="triggerClass" type="button" :disabled="disabled" :data-disabled="dataDisabled">
            {{ fetchedModels.length ? '选择拉取到的模型' : '未拉取到模型，可手动输入' }}
          </button>
        </template>
        <AppSelectItem v-for="model in fetchedModels" :key="model.id" :value="model.id" :disabled="model.isAdded">
          <span class="settings-dropdown-item-title">
            <span>{{ model.name || model.id }}</span>
            <small v-if="model.isAdded" class="settings-dropdown-item-badge">已添加</small>
          </span>
          <code class="settings-dropdown-item-code">{{ model.id }}</code>
        </AppSelectItem>
      </AppSelect>
    </div>

    <div class="model-draft-grid">
      <label class="settings-field">
        <span>模型 ID</span>
        <input
          v-model="draft.modelId"
          class="settings-input"
          placeholder="可手动输入，或从上方选择"
          autocomplete="off"
        />
      </label>
      <label class="settings-field">
        <span>模型名称</span>
        <input v-model="draft.modelName" class="settings-input" placeholder="可选，默认同模型 ID" autocomplete="off" />
      </label>
      <label class="settings-field">
        <span>Context Window</span>
        <input
          v-model="draft.contextWindow"
          class="settings-input"
          inputmode="numeric"
          placeholder="128000"
          autocomplete="off"
        />
      </label>
      <label class="settings-checkbox-field model-draft-check">
        <AppCheckbox
          :model-value="draft.supportsImageInput"
          @update:model-value="draft.supportsImageInput = $event === true"
        />
        <span>支持图像输入</span>
      </label>
    </div>
  </div>
</template>

<style lang="scss">
@use '../styles/controls';

/* 非 scoped：样式全部限定在 .model-draft-fields 前缀下，不影响外部。 */
.model-draft-fields {
  @apply flex flex-col gap-2;
}

.model-draft-fetch-row {
  @apply grid grid-cols-[auto_minmax(0,1fr)] gap-2;
}

.model-draft-grid {
  @apply grid grid-cols-2 gap-2;
}

.model-draft-check {
  @apply self-end pb-1.5;
}
</style>
