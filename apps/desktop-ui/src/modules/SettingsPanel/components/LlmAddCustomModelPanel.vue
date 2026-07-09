<script setup lang="ts">
import type { FetchedCustomProviderModel } from '@chaptale/ipc-contract';

import AppButton from '@/components/AppButton/AppButton.vue';
import AppDialog from '@/components/AppDialog/AppDialog.vue';
import AppScrollArea from '@/components/AppScrollArea/AppScrollArea.vue';
import type { CustomModelDraft } from '../utils/custom-model-draft';
import CustomModelDraftForm from './CustomModelDraftForm.vue';

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
  <AppDialog
    :open="props.open"
    :title="props.title"
    description="模型 ID、Context Window 与图像输入能力都按单个模型保存。"
    @update:open="emit('update:open', $event)"
  >
    <template #default="{ close }">
      <AppScrollArea class="settings-dialog-form-scroll">
        <form class="settings-dialog-form" @submit.prevent="emit('submit')">
          <CustomModelDraftForm
            :draft="props.draft"
            :fetched-models="props.fetchedModels"
            :is-fetching="props.isFetching"
            :can-fetch="props.canFetch"
            fetch-disabled-reason="需要先保存模型 Key 才能拉取模型"
            @fetch="emit('fetch')"
          />
          <div class="settings-dialog-form-actions">
            <AppButton type="button" @click="close">取消</AppButton>
            <AppButton variant="primary" type="submit" :disabled="!props.canSubmit">
              {{ props.submitLabel }}
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
