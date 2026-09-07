<script setup lang="ts">
import { ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppForm, AppFormActions } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { AppNumberInput } from '@/components/AppNumberInput';
import { useFileTreeStore, useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { useEditorStore } from '../store';

const editor = useEditorStore();
const workspace = useWorkspaceStore();
const tree = useFileTreeStore();
const title = ref('');
const filename = ref('');
const directory = ref('');
const order = ref<number | undefined>(1);
const error = ref('');
const busy = ref(false);
let suggestedName = '';

watch([title, order], () => {
  const next = `${String(order.value ?? 1).padStart(4, '0')}-${title.value.replace(/[<>:"/\\|?*]/g, '').trim() || '未命名'}.md`;
  if (!filename.value || filename.value === suggestedName) filename.value = next;
  suggestedName = next;
});

watch(
  () => editor.newChapterOpen,
  async open => {
    if (!open || !workspace.rootPath) return;
    const rootPath = workspace.rootPath;
    title.value = '';
    filename.value = '';
    error.value = '';
    busy.value = true;
    try {
      const result = await getDesktopApi().workspace.getLayout({ rootPath });
      if (workspace.rootPath !== rootPath) return;
      if (result.ok) directory.value = result.layout.roles.manuscript.relativePath;
      else error.value = result.message;
    } catch (cause) {
      error.value = toErrorMessage(cause);
    } finally {
      busy.value = false;
    }
  }
);

async function create() {
  const rootPath = workspace.rootPath;
  if (!rootPath || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await getDesktopApi().workspace.createChapter({
      rootPath,
      title: title.value,
      filename: filename.value,
      order: order.value ?? 1,
      relativeDirectory: directory.value
    });
    if (workspace.rootPath !== rootPath) return;
    if (!result.ok) {
      error.value = result.message;
      return;
    }
    editor.newChapterOpen = false;
    await tree.reload();
    await editor.openDocument(result.document.relativePath);
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog
    :open="editor.newChapterOpen"
    title="新建章节"
    @update:open="
      value => {
        editor.newChapterOpen = value;
      }
    "
  >
    <AppForm class="chapter-form" @submit="create">
      <label>标题<AppInput v-model="title" aria-label="章节标题" maxlength="200" /></label>
      <label>顺序<AppNumberInput v-model="order" :min="1" :max="1000000" aria-label="章节顺序" /></label>
      <label>目录<AppInput v-model="directory" aria-label="章节目录" /></label>
      <label>文件名<AppInput v-model="filename" aria-label="章节文件名" maxlength="160" /></label>
      <p v-if="error" class="chapter-error" role="alert">{{ error }}</p>
      <AppFormActions>
        <AppButton type="button" @click="editor.newChapterOpen = false">取消</AppButton>
        <AppButton type="submit" variant="primary" :disabled="busy || !title.trim() || !filename.trim()">
          <span class="i-mingcute-file-new-line size-4" aria-hidden="true" />创建章节
        </AppButton>
      </AppFormActions>
    </AppForm>
  </AppDialog>
</template>

<style scoped>
.chapter-form {
  display: grid;
  gap: 12px;
  padding-top: 16px;
  overflow: auto;
}
.chapter-form label {
  display: grid;
  gap: 5px;
  font-size: 12px;
}
.chapter-error {
  color: var(--destructive);
  font-size: 12px;
  overflow-wrap: anywhere;
}
</style>
