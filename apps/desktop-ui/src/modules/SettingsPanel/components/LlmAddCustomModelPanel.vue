<script setup lang="ts">
import type { FetchedCustomProviderModel } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppForm, AppFormActions } from '@/components/AppForm';
import { AppScrollArea } from '@/components/AppScrollArea';
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
        <AppForm class="llm-model-dialog-form" @submit="emit('submit')">
          <CustomModelDraftForm
            :draft="props.draft"
            :fetched-models="props.fetchedModels"
            :is-fetching="props.isFetching"
            :can-fetch="props.canFetch"
            fetch-disabled-reason="需要先保存 API Key 才能拉取模型"
            @fetch="emit('fetch')"
          />
          <AppFormActions>
            <AppButton type="button" @click="close">取消</AppButton>
            <AppButton variant="primary" type="submit" :disabled="!props.canSubmit">
              {{ props.submitLabel }}
            </AppButton>
          </AppFormActions>
        </AppForm>
      </AppScrollArea>
    </template>
  </AppDialog>
</template>

<style scoped lang="scss">
@use '../styles/dialog';

.llm-model-dialog-form {
  @apply flex flex-col gap-4;
}
</style>
