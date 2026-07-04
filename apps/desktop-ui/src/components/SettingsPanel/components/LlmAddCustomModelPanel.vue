<script setup lang="ts">
import type { FetchedCustomProviderModel } from '@chaptale/ipc-contract';

import CustomModelDraftForm from './CustomModelDraftForm.vue';
import type { CustomModelDraft } from '../utils/custom-model-draft';

const props = defineProps<{
  draft: CustomModelDraft;
  fetchedModels: FetchedCustomProviderModel[];
  isFetching: boolean;
  canFetch: boolean;
  canSubmit: boolean;
}>();

const emit = defineEmits<{
  fetch: [];
  submit: [];
}>();
</script>

<template>
  <div class="settings-add-model-panel">
    <span class="settings-path-label">添加模型</span>
    <CustomModelDraftForm
      :draft="props.draft"
      :fetched-models="props.fetchedModels"
      :is-fetching="props.isFetching"
      :can-fetch="props.canFetch"
      fetch-disabled-reason="需要先保存模型 Key 才能拉取模型"
      @fetch="emit('fetch')"
    />
    <div class="settings-actions">
      <button class="settings-primary-button" type="button" :disabled="!props.canSubmit" @click="emit('submit')">
        添加模型
      </button>
    </div>
  </div>
</template>
