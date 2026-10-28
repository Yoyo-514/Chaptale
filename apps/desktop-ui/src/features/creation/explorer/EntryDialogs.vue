<script setup lang="ts">
import { computed, ref } from 'vue';

import type { Entry } from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { AppAlertDialog, AppDialog } from '@/components/AppDialog';
import { AppForm, AppFormActions } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { useEditorStore } from '@/features/editor';
import { toErrorMessage } from '@/utils/desktop-api';

import { requestCreation, useCreationStore } from '../store';
import { useTrashStore } from '../trash/store';

const emit = defineEmits<{ error: [message: string] }>();
const creation = useCreationStore();
const editor = useEditorStore();
const trash = useTrashStore();
const target = ref<Entry>();
const action = ref<'rename' | 'move' | null>(null);
const title = ref('');
const parent = ref('root');
const busy = ref(false);
const error = ref('');
// 确认框先关闭再派发 confirm，删除目标与打开状态分开保存。
const removing = ref<{ entry: Entry; entryCount: number; pendingCount: number } | null>(null);
const removeOpen = ref(false);
const directories = computed(() =>
  creation.entries.filter(
    item => item.kind === 'directory' && item.section === creation.view?.section && item.id !== target.value?.id
  )
);

/** 文档改名走编辑器的标题字段，随保存提交；目录改名直接提交。 */
async function rename(entry: Entry) {
  target.value = entry;
  error.value = '';
  if (entry.kind === 'document') {
    await editor.openDocument(entry.id);
    const tab = editor.tabs.find(item => item.id === entry.id)!;
    if (tab.status !== 'ready') {
      emit('error', tab.status === 'loading' ? '文档正在加载，请稍后重试' : tab.error);
      return;
    }
    title.value = tab.title;
  } else title.value = entry.title;
  action.value = 'rename';
}
function move(entry: Entry) {
  target.value = entry;
  error.value = '';
  parent.value = entry.parentId ?? 'root';
  action.value = 'move';
}
/** 删除前读取影响范围，确认框写明一并拒绝的待审修改。 */
async function remove(entry: Entry) {
  try {
    removing.value = { entry, ...(await trash.impact([entry.id])) };
    removeOpen.value = true;
  } catch (cause) {
    emit('error', toErrorMessage(cause));
  }
}

async function submit() {
  busy.value = true;
  error.value = '';
  try {
    const entry = target.value!;
    if (action.value === 'rename' && entry.kind === 'document') editor.updateMetadata(entry.id, { title: title.value });
    else {
      if (action.value === 'rename')
        await requestCreation('renameEntry', {
          commandId: crypto.randomUUID(),
          workId: creation.workId!,
          entryId: entry.id,
          expectedRevisionId: entry.revisionId,
          title: title.value
        });
      else await creation.move(entry, parent.value === 'root' ? null : parent.value, null);
      await creation.refreshEntries();
    }
    action.value = null;
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
async function confirmRemove() {
  const { entry } = removing.value!;
  try {
    // 先关闭其中已打开的文档，未保存的输入由作者在关闭时处理。
    const ids = new Set([entry.id]);
    for (let size = 0; size !== ids.size;) {
      size = ids.size;
      for (const item of creation.entries) if (item.parentId !== null && ids.has(item.parentId)) ids.add(item.id);
    }
    for (const tab of editor.tabs.filter(item => ids.has(item.id))) await editor.closeTab(tab.id);
    if (editor.tabs.some(item => ids.has(item.id))) return;
    await trash.trash([entry.id]);
  } catch (cause) {
    emit('error', toErrorMessage(cause));
  }
}

defineExpose({ rename, move, remove });
</script>

<template>
  <AppAlertDialog
    v-model:open="removeOpen"
    :title="`删除“${removing?.entry.title}”？`"
    confirm-label="删除"
    @confirm="confirmRemove"
  >
    <template #description
      >{{
        removing && removing.entryCount > 1
          ? `目录及其中 ${removing.entryCount - 1} 项内容会移入作品回收站，可以恢复。`
          : '会移入作品回收站，可以恢复。'
      }}<template v-if="removing?.pendingCount">将一并拒绝 {{ removing.pendingCount }} 处待审修改。</template></template
    >
  </AppAlertDialog>
  <AppDialog
    content-size="sm"
    :open="Boolean(action)"
    :title="action === 'rename' ? (target?.kind === 'document' ? '重命名文档' : '重命名目录') : '移动条目'"
    @update:open="
      value => {
        if (!value && !busy) action = null;
      }
    "
  >
    <AppForm class="entry-form" :disabled="busy" @submit="submit">
      <label v-if="action === 'rename'"
        >{{ target?.kind === 'document' ? '文档标题' : '目录名称'
        }}<AppInput v-model="title" :aria-label="target?.kind === 'document' ? '文档标题' : '目录名称'" autofocus
      /></label>
      <label v-else
        >目标目录<AppSelect v-model="parent" aria-label="目标目录"
          ><AppSelectItem value="root">根目录</AppSelectItem
          ><AppSelectItem v-for="directory in directories" :key="directory.id" :value="directory.id">{{
            directory.title
          }}</AppSelectItem></AppSelect
        ></label
      >
      <p v-if="error" role="alert" class="entry-error">{{ error }}</p>
      <AppFormActions
        ><AppButton :disabled="busy" @click="action = null">取消</AppButton
        ><AppButton type="submit" variant="primary" :disabled="busy || (action === 'rename' && !title.trim())"
          >确认</AppButton
        ></AppFormActions
      >
    </AppForm>
  </AppDialog>
</template>

<style scoped>
.entry-form {
  display: grid;
  gap: 12px;
  padding: 12px 0 0;
}
.entry-form label {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
.entry-error {
  margin: 0;
  font-size: 12px;
  color: var(--destructive);
}
</style>
