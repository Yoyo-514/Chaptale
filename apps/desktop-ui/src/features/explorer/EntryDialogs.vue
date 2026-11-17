<script setup lang="ts">
import { computed, ref } from 'vue';

import type { Entry, TrashImpact } from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { AppAlertDialog, AppDialog } from '@/components/AppDialog';
import { AppForm, AppFormActions } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { requestCreation, useCreationStore, useTrashStore } from '@/features/creation';
import { useEditorStore } from '@/features/editor';
import { toErrorMessage } from '@/utils/desktop-api';

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
const removing = ref<({ entry: Entry } & TrashImpact) | null>(null);
const nameLabels = {
  document: { noun: '文档', field: '文档标题' },
  directory: { noun: '目录', field: '目录名称' },
  file: { noun: '文件', field: '文件名称' }
} as const;
const stateNames = { active: '进行中', ended: '已结束', undetermined: '起止待定' } as const;
const titleOf = (id: string) => creation.entries.find(item => item.id === id)?.title ?? '已删除的资料';
/** 删除章节对事件与关系的影响，逐行写明。 */
const storyImpact = computed(() => {
  const impact = removing.value;
  if (!impact) return [];
  const lines: string[] = [];
  const moved = [
    impact.recordCount && `${impact.recordCount} 条事件`,
    impact.milestoneCount && `${impact.milestoneCount} 处关系建立／结束`
  ].filter(Boolean);
  if (moved.length) lines.push(`出自本章的 ${moved.join('、')}随章节移入回收站，恢复章节时一起回来。`);
  if (impact.relocatedCount) lines.push(`${impact.relocatedCount} 条发生在本章、出自别处的记录将显示为“待重新定位”。`);
  for (const change of impact.relationChanges) {
    const name = `${change.resourceIds.map(titleOf).join('与')}的${change.type}关系`;
    lines.push(
      change.change.kind === 'removed'
        ? `${name}整条移入回收站。`
        : `${name}从《${titleOf(change.change.fromChapterId)}》起变为${stateNames[change.change.state]}。`
    );
  }
  return lines;
});
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
    <ul v-if="storyImpact.length" class="remove-impact">
      <li v-for="line in storyImpact" :key="line">{{ line }}</li>
    </ul>
  </AppAlertDialog>
  <AppDialog
    content-size="sm"
    :open="Boolean(action)"
    :title="action === 'rename' ? `重命名${nameLabels[target?.kind ?? 'directory'].noun}` : '移动条目'"
    @update:open="
      value => {
        if (!value && !busy) action = null;
      }
    "
  >
    <AppForm class="entry-form" :disabled="busy" @submit="submit">
      <label v-if="action === 'rename'"
        >{{ nameLabels[target?.kind ?? 'directory'].field
        }}<AppInput v-model="title" :aria-label="nameLabels[target?.kind ?? 'directory'].field" autofocus
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
.remove-impact {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius-control-sm);
  background: var(--surface-muted);
  color: var(--muted-foreground);
  font-size: 13px;
  line-height: 1.6;
  list-style: none;
}
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
