<script setup lang="ts">
import type { FetchedCustomProviderModel } from '@chaptale/ipc-contract';
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

const props = defineProps<{
  open: boolean;
  title: string;
  submitLabel: string;
  draft: CustomModelDraft;
  fetchedModels: FetchedCustomProviderModel[];
  isFetching: boolean;
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
  <DialogRoot :open="props.open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="settings-dialog-overlay" />
      <DialogContent class="settings-dialog-content settings-model-dialog">
        <div class="settings-dialog-header">
          <div>
            <DialogTitle class="settings-dialog-title">{{ props.title }}</DialogTitle>
            <DialogDescription class="settings-dialog-description">
              模型 ID、Context Window 与图像输入能力都按单个模型保存。
            </DialogDescription>
          </div>
          <DialogClose class="settings-dialog-close" aria-label="关闭">
            <span class="i-mingcute-close-line" aria-hidden="true" />
          </DialogClose>
        </div>

        <form class="settings-dialog-body" @submit.prevent="emit('submit')">
          <CustomModelDraftForm
            :draft="props.draft"
            :fetched-models="props.fetchedModels"
            :is-fetching="props.isFetching"
            :can-fetch="props.canFetch"
            fetch-disabled-reason="需要先保存模型 Key 才能拉取模型"
            @fetch="emit('fetch')"
          />
          <div class="settings-dialog-actions">
            <DialogClose class="settings-secondary-button" type="button">取消</DialogClose>
            <button class="settings-primary-button" type="submit" :disabled="!props.canSubmit">
              {{ props.submitLabel }}
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
