<script setup lang="ts">
import type { FetchedCustomProviderModel } from '@chaptale/ipc-contract';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui';

import type { CustomModelDraft } from './custom-model-draft';

/**
 * 自定义模型草稿表单（供“添加供应商”与“已有供应商添加模型”复用）。
 *
 * - 拉取模型是辅助能力：可从下拉选择，也可以手动输入模型 ID；
 * - Context Window 与图像输入按“每个模型”配置。
 */
const props = defineProps<{
  draft: CustomModelDraft;
  fetchedModels: FetchedCustomProviderModel[];
  isFetching: boolean;
  canFetch: boolean;
  fetchDisabledReason?: string;
}>();

const emit = defineEmits<{
  fetch: [];
}>();

function selectModel(model: FetchedCustomProviderModel) {
  props.draft.modelId = model.id;
  props.draft.modelName = model.name || model.id;
}
</script>

<template>
  <div class="model-draft-fields">
    <div class="model-draft-fetch-row">
      <button
        class="settings-secondary-button"
        type="button"
        :disabled="isFetching || !canFetch"
        :title="!canFetch ? fetchDisabledReason : undefined"
        @click="emit('fetch')"
      >
        {{ isFetching ? '拉取中...' : '拉取模型' }}
      </button>
      <DropdownMenuRoot>
        <DropdownMenuTrigger class="settings-dropdown-trigger" :disabled="fetchedModels.length === 0">
          {{ fetchedModels.length ? '选择拉取到的模型' : '未拉取到模型，可手动输入' }}
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent class="settings-dropdown-content" :side-offset="6" align="start">
            <DropdownMenuItem
              v-for="model in fetchedModels"
              :key="model.id"
              class="settings-dropdown-item"
              @select="selectModel(model)"
            >
              <span>{{ model.name || model.id }}</span>
              <code>{{ model.id }}</code>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
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
        <input v-model="draft.supportsImageInput" type="checkbox" />
        <span>支持图像输入</span>
      </label>
    </div>
  </div>
</template>

<style lang="scss">
/* 非 scoped：样式全部限定在 .model-draft-fields 前缀下，不影响外部。 */
.model-draft-fields {
  @apply flex flex-col gap-2;

  .settings-field {
    @apply flex min-w-0 flex-col gap-1 text-xs;

    color: var(--muted-foreground);
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

  .settings-input:focus-visible {
    box-shadow: var(--input-focus-shadow);
  }

  .settings-secondary-button {
    @apply border px-3 py-1.5 text-xs font-medium outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60;

    background: var(--surface-muted);
    border-color: var(--border-subtle);
    border-radius: calc(var(--radius) * 0.5);
    color: var(--foreground);
  }

  .settings-secondary-button:hover:not(:disabled) {
    background: var(--secondary);
    color: var(--secondary-foreground);
  }

  .settings-checkbox-field {
    @apply flex items-start gap-2 text-xs leading-5;

    color: var(--foreground);
  }

  .settings-checkbox-field input {
    @apply mt-1 size-3.5 shrink-0;

    accent-color: var(--primary-solid);
  }

  .settings-dropdown-trigger {
    @apply flex w-full min-w-0 items-center justify-between gap-2 border px-3 py-1.5 text-left text-xs outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60;

    background: var(--input);
    border-color: var(--input-border);
    border-radius: calc(var(--radius) * 0.5);
    color: var(--foreground);
  }
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
