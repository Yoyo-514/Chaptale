<script setup lang="ts">
import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppFormActions } from '@/components/AppForm';

import { useEditorStore } from '../store';

const editor = useEditorStore();
</script>

<template>
  <AppDialog
    :open="Boolean(editor.unsavedPrompt)"
    title="保存未保存的修改？"
    @update:open="
      open => {
        if (!open) editor.resolveUnsaved('cancel');
      }
    "
  >
    <ul class="unsaved-files">
      <li v-for="path in editor.unsavedPrompt?.paths" :key="path">{{ path }}</li>
    </ul>
    <AppFormActions>
      <AppButton @click="editor.resolveUnsaved('cancel')">取消</AppButton>
      <AppButton @click="editor.resolveUnsaved('discard')">不保存</AppButton>
      <AppButton variant="primary" @click="editor.resolveUnsaved('save')">
        <span class="i-mingcute-save-line size-4" aria-hidden="true" />保存并继续
      </AppButton>
    </AppFormActions>
  </AppDialog>
</template>

<style scoped>
.unsaved-files {
  padding: 16px 20px;
  margin: 0;
  overflow: auto;
  font-size: var(--ui-font-size);
  overflow-wrap: anywhere;
}
</style>
