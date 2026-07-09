<script setup lang="ts">
import AppButton from '@/components/AppButton/AppButton.vue';
import type { ModelGroup, ProviderView } from '../utils/llm-settings.helpers';

const props = defineProps<{
  provider: ProviderView;
  activeModelGroup: ModelGroup;
  apiKey?: string;
  isSaving: boolean;
  placeholder: string;
}>();

const emit = defineEmits<{
  'update:apiKey': [value: string];
  submit: [];
  remove: [];
}>();

function updateApiKey(event: Event) {
  emit('update:apiKey', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="settings-auth-panel">
    <label class="settings-key-field">
      <span>{{ props.activeModelGroup === 'custom' ? '模型 Key' : 'API Key' }}</span>
      <input
        :value="props.apiKey"
        class="settings-input"
        type="password"
        autocomplete="off"
        :placeholder="props.placeholder"
        :disabled="props.isSaving"
        @input="updateApiKey"
        @keydown.enter.prevent="emit('submit')"
      />
    </label>
    <div class="settings-auth-actions">
      <AppButton variant="primary" type="button" :disabled="props.isSaving" @click="emit('submit')">
        {{ props.isSaving ? '保存中...' : props.activeModelGroup === 'custom' ? '保存模型 Key' : '保存凭据' }}
      </AppButton>
      <AppButton
        type="button"
        :disabled="props.isSaving || (props.activeModelGroup !== 'custom' && !props.provider.authConfigured)"
        @click="emit('remove')"
      >
        {{ props.activeModelGroup === 'custom' ? '移除模型 Key' : '移除凭据' }}
      </AppButton>
    </div>
  </div>
</template>
