<script setup lang="ts">
import { ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppForm, AppFormActions } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { useEditorStore } from '@/features/editor';
import { toErrorMessage } from '@/utils/desktop-api';

import { useCreationStore } from '../store';

const creation = useCreationStore();
const editor = useEditorStore();
const title = ref('');
const kind = ref<'novel' | 'script'>('novel');
const busy = ref(false);
const error = ref('');
let previous = '';
let commandId = '';
watch(
  () => [creation.newWorkOpen, creation.newEntry],
  () => {
    title.value = '';
    error.value = '';
    previous = '';
    commandId = '';
  }
);
async function create() {
  if (busy.value || !title.value.trim()) return;
  busy.value = true;
  error.value = '';
  const identity = JSON.stringify([creation.newWorkOpen, creation.workId, creation.newEntry, title.value, kind.value]);
  if (previous !== identity) {
    previous = identity;
    commandId = crypto.randomUUID();
  }
  try {
    if (creation.newWorkOpen) await creation.createWork(title.value, kind.value, commandId);
    else {
      const entry = await creation.createEntry(title.value, 'txt', commandId);
      if (entry.kind === 'document') await editor.openDocument(entry.id);
    }
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
function close() {
  if (!busy.value) {
    creation.newWorkOpen = false;
    creation.newEntry = null;
  }
}
</script>

<template>
  <AppDialog
    content-size="sm"
    :open="creation.newWorkOpen || Boolean(creation.newEntry)"
    :title="creation.newWorkOpen ? '新建作品' : creation.newEntry?.kind === 'directory' ? '新建目录' : '新建文档'"
    @update:open="open => !open && close()"
  >
    <AppForm class="creation-form" :disabled="busy" @submit="create">
      <label
        >{{ creation.newWorkOpen ? '作品名称' : creation.newEntry?.kind === 'directory' ? '目录名称' : '文档标题' }}
        <AppInput
          v-model="title"
          :aria-label="
            creation.newWorkOpen ? '作品名称' : creation.newEntry?.kind === 'directory' ? '目录名称' : '文档标题'
          "
          autofocus
        />
      </label>
      <label v-if="creation.newWorkOpen"
        >作品类型
        <AppSelect v-model="kind" aria-label="作品类型"
          ><AppSelectItem value="novel">小说</AppSelectItem
          ><AppSelectItem value="script">剧本</AppSelectItem></AppSelect
        >
      </label>
      <p v-if="error" role="alert">{{ error }}</p>
      <AppFormActions>
        <AppButton :disabled="busy" @click="close">取消</AppButton>
        <AppButton type="submit" variant="primary" :disabled="busy || !title.trim()">{{
          busy
            ? '正在创建…'
            : creation.newWorkOpen
              ? '创建作品'
              : creation.newEntry?.kind === 'directory'
                ? '创建目录'
                : '创建文档'
        }}</AppButton>
      </AppFormActions>
    </AppForm>
  </AppDialog>
</template>
<style scoped>
.creation-form {
  padding: 12px 0 0;
  display: grid;
  gap: 12px;
}
label {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
p {
  margin: 0;
  color: var(--destructive);
}
</style>
