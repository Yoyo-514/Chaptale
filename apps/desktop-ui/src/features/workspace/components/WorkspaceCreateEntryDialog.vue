<script setup lang="ts">
import { nextTick, ref, watch, type ComponentPublicInstance } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppForm, AppFormActions } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';

const props = defineProps<{
  open: boolean;
  kind: 'file' | 'directory';
  /** 目标父目录的相对路径；空串表示作品根。 */
  parent: string;
}>();

const emit = defineEmits<{
  'update:open': [open: boolean];
  submit: [name: string];
}>();

const draftName = ref('');
const inputRef = ref<ComponentPublicInstance | null>(null);

watch(
  () => props.open,
  async open => {
    if (!open) return;

    draftName.value = '';
    // 对话框内容由 Portal 挂载，要等它进 DOM 才聚焦得上；AppInput 的根节点是包层，真正可聚焦的是里面的 input。
    await nextTick();
    (inputRef.value?.$el as HTMLElement | undefined)?.querySelector('input')?.focus();
  }
);

function submit() {
  const name = draftName.value.trim();
  if (!name) return;

  emit('submit', name);
}
</script>

<template>
  <AppDialog
    :open="props.open"
    :title="props.kind === 'directory' ? '新建文件夹' : '新建文件'"
    :description="props.parent ? `将创建在 ${props.parent}/ 下` : '将创建在作品根目录下'"
    @update:open="emit('update:open', $event)"
  >
    <AppForm class="workspace-create-form" @submit="submit">
      <AppInput
        ref="inputRef"
        v-model="draftName"
        :placeholder="props.kind === 'directory' ? '文件夹名称' : '文件名，例如 第一章.md'"
        :aria-label="props.kind === 'directory' ? '文件夹名称' : '文件名'"
        maxlength="120"
      />
      <AppFormActions>
        <AppButton type="button" @click="emit('update:open', false)">取消</AppButton>
        <AppButton variant="primary" type="submit" :disabled="!draftName.trim()">创建</AppButton>
      </AppFormActions>
    </AppForm>
  </AppDialog>
</template>

<style scoped lang="scss">
.workspace-create-form {
  @apply flex flex-col gap-3 pt-3;
}
</style>
