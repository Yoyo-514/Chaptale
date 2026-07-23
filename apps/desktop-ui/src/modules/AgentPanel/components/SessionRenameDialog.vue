<script setup lang="ts">
import { ref, watch } from 'vue';

import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppForm, AppFormActions } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { getSessionTitle } from '@/utils/session-display';

const props = defineProps<{
  session: ChaptaleSessionListItem;
  triggerClass?: string;
}>();

const emit = defineEmits<{
  rename: [sessionId: string, name: string];
}>();

const isOpen = ref(false);
const draftName = ref('');

watch(isOpen, open => {
  if (open) {
    draftName.value = props.session.name ?? '';
  }
});

function submit() {
  const name = draftName.value.trim();

  if (name && name !== props.session.name) {
    emit('rename', props.session.id, name);
  }

  isOpen.value = false;
}
</script>

<template>
  <AppButton
    :class="props.triggerClass"
    icon
    variant="ghost"
    type="button"
    size="xs"
    :aria-label="`重命名 ${getSessionTitle(props.session)}`"
    @click="isOpen = true"
  >
    <span class="i-mingcute-edit-2-line size-4" aria-hidden="true" />
  </AppButton>

  <AppDialog
    :open="isOpen"
    title="重命名会话"
    description="为会话设置一个更容易辨认的名字。"
    @update:open="open => (isOpen = open)"
  >
    <AppForm class="session-rename-form" @submit="submit">
      <AppInput
        v-model="draftName"
        :placeholder="getSessionTitle(props.session)"
        aria-label="会话名称"
        maxlength="60"
      />
      <AppFormActions>
        <AppButton type="button" @click="isOpen = false">取消</AppButton>
        <AppButton variant="primary" type="submit">保存</AppButton>
      </AppFormActions>
    </AppForm>
  </AppDialog>
</template>

<style scoped lang="scss">
.session-rename-form {
  @apply flex flex-col gap-3 pt-3;
}
</style>
