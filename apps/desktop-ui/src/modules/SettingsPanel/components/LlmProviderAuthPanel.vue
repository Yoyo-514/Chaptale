<script setup lang="ts">
import { AppButton } from '@/components/AppButton';
import { AppForm, AppFormActions, AppFormField } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';

const props = defineProps<{
  apiKey?: string;
  isSaving: boolean;
  canRemove: boolean;
  placeholder: string;
}>();

const emit = defineEmits<{
  'update:apiKey': [value: string];
  submit: [];
  remove: [];
}>();
</script>

<template>
  <AppForm class="settings-auth-panel" :disabled="props.isSaving" @submit="emit('submit')">
    <AppFormField label="API Key">
      <template #default="{ controlAttrs }">
        <AppInput
          v-bind="controlAttrs"
          :model-value="props.apiKey"
          type="password"
          autocomplete="off"
          :placeholder="props.placeholder"
          @update:model-value="emit('update:apiKey', $event)"
        />
      </template>
    </AppFormField>

    <AppFormActions>
      <AppButton variant="primary" type="submit" :disabled="props.isSaving">
        {{ props.isSaving ? '保存中...' : '保存 API Key' }}
      </AppButton>
      <AppButton type="button" :disabled="props.isSaving || !props.canRemove" @click="emit('remove')">
        移除 API Key
      </AppButton>
    </AppFormActions>
  </AppForm>
</template>
