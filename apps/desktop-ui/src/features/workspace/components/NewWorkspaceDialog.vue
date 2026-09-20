<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { CreateWorkspaceResult } from '@chaptale/ipc-contract';
import type { WorkspaceRole } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppDialog } from '@/components/AppDialog';
import { AppForm, AppFormActions } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTextarea } from '@/components/AppTextarea';
import { useEditorStore } from '@/features/editor';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { useWorkspaceStore } from '../store';

const workspace = useWorkspaceStore();
const editor = useEditorStore();
const title = ref('');
const directoryName = ref('');
const parentPath = ref('');
const kind = ref('novel');
const firstChapter = ref(true);
const styleGuide = ref('');
const optionalRoles = [
  { value: 'outline', label: '大纲' },
  { value: 'characters', label: '角色' },
  { value: 'threads', label: '伏笔' },
  { value: 'drafts', label: '草稿' },
  { value: 'inspiration', label: '灵感' },
  { value: 'templates', label: '模板' }
] satisfies Array<{ value: WorkspaceRole; label: string }>;
const roles = ref<WorkspaceRole[]>(['outline', 'characters', 'threads', 'drafts', 'inspiration']);
const error = ref('');
const busy = ref(false);
const created = ref<Extract<CreateWorkspaceResult, { ok: true }> | null>(null);
const targetPath = computed(() => `${parentPath.value.replace(/[\\/]+$/, '')}/${directoryName.value}`);
let suggestion = '';
watch(title, value => {
  const next = value
    .replace(/[<>:"/\\|?*]/g, '')
    .trim()
    .replace(/\.+$/, '');
  if (!directoryName.value || directoryName.value === suggestion) directoryName.value = next;
  suggestion = next;
});
watch(
  () => workspace.newWorkspaceOpen,
  open => {
    if (open) {
      error.value = '';
      created.value = null;
      if (workspace.newWorkspaceParentPath !== null) {
        parentPath.value = workspace.newWorkspaceParentPath;
        workspace.newWorkspaceParentPath = null;
      }
    }
  }
);
async function selectParent() {
  try {
    const selected = await getDesktopApi().workspace.selectParent(
      parentPath.value ? { defaultPath: parentPath.value } : undefined
    );
    if (selected) parentPath.value = selected;
  } catch (cause) {
    error.value = toErrorMessage(cause);
  }
}
async function openCreated() {
  if (!created.value) return;
  await workspace.openRecent(created.value.rootPath);
  if (workspace.rootPath !== created.value.rootPath) return;
  await editor.openDocument(created.value.firstDocument);
  workspace.newWorkspaceOpen = false;
}
async function create() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    if (created.value) {
      await openCreated();
      return;
    }
    const result = await getDesktopApi().workspace.createWorkspace({
      parentPath: parentPath.value,
      directoryName: directoryName.value,
      title: title.value,
      kind: kind.value === 'script' ? 'script' : 'novel',
      roles: [...roles.value],
      firstChapter: firstChapter.value,
      styleGuide: styleGuide.value
    });
    if (!result.ok) {
      error.value = `${result.message}${result.partialPath ? ` 已保留部分文件：${result.partialPath}` : ''}`;
      return;
    }
    created.value = result;
    await openCreated();
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog
    :open="workspace.newWorkspaceOpen"
    title="新建作品"
    @update:open="value => !busy && (workspace.newWorkspaceOpen = value)"
  >
    <AppForm class="new-workspace-form" :disabled="busy" @submit="create">
      <template v-if="!created">
        <label>作品名称<AppInput v-model="title" aria-label="作品名称" maxlength="200" autofocus /></label>
        <div class="new-workspace-grid">
          <label
            >作品类型<AppSelect v-model="kind" aria-label="作品类型"
              ><AppSelectItem value="novel">小说</AppSelectItem
              ><AppSelectItem value="script">剧本</AppSelectItem></AppSelect
            ></label
          >
          <label>目录名<AppInput v-model="directoryName" aria-label="作品目录名" maxlength="120" /></label>
        </div>
        <label
          >存放位置
          <div class="new-workspace-location">
            <AppInput v-model="parentPath" aria-label="作品存放位置" />
            <AppButton icon aria-label="选择作品存放位置" title="选择目录" @click="selectParent"
              ><span class="i-mingcute-folder-open-2-line size-4" aria-hidden="true"
            /></AppButton>
          </div>
        </label>
        <output v-if="parentPath && directoryName" class="new-workspace-path">{{ targetPath }}</output>
        <fieldset>
          <legend>资料库</legend>
          <div class="new-workspace-roles">
            <label><AppCheckbox :model-value="true" disabled aria-label="正文" />正文</label>
            <label><AppCheckbox :model-value="true" disabled aria-label="设定" />设定</label>
            <label v-for="role in optionalRoles" :key="role.value">
              <AppCheckbox
                :model-value="roles.includes(role.value)"
                :aria-label="role.label"
                @update:model-value="
                  checked => (roles = checked ? [...roles, role.value] : roles.filter(value => value !== role.value))
                "
              />{{ role.label }}
            </label>
          </div>
        </fieldset>
        <label class="new-workspace-check"
          ><AppCheckbox v-model="firstChapter" aria-label="创建第一章" />创建第一章</label
        >
        <label
          >创作守则<AppTextarea
            v-model="styleGuide"
            aria-label="创作守则"
            :rows="4"
            maxlength="32000"
            placeholder="叙述视角、文风、禁忌（可留空）"
        /></label>
      </template>
      <div v-else class="new-workspace-created">
        <p>作品已创建</p>
        <output>{{ created.rootPath }}</output>
      </div>
      <p v-if="error" class="new-workspace-error" role="alert">{{ error }}</p>
      <AppFormActions>
        <AppButton :disabled="busy" @click="workspace.newWorkspaceOpen = false">取消</AppButton>
        <AppButton
          type="submit"
          variant="primary"
          :disabled="busy || (!created && (!title.trim() || !directoryName.trim() || !parentPath.trim()))"
        >
          <span class="i-mingcute-book-2-line size-4" aria-hidden="true" />{{
            created ? '打开作品' : busy ? '正在创建…' : '创建并打开'
          }}
        </AppButton>
      </AppFormActions>
    </AppForm>
  </AppDialog>
</template>

<style scoped lang="scss">
.new-workspace-form {
  @apply grid gap-4 overflow-auto pt-4;
  font-size: var(--ui-font-size);
}
.new-workspace-form label {
  @apply grid min-w-0 gap-1.5;
}
.new-workspace-grid {
  @apply grid grid-cols-2 gap-3;
}
.new-workspace-location {
  @apply flex min-w-0 gap-2;
}
.new-workspace-location :deep(.app-input) {
  @apply min-w-0 flex-1;
}
.new-workspace-path,
.new-workspace-created output {
  overflow-wrap: anywhere;
  color: var(--muted-foreground);
}
.new-workspace-roles {
  @apply mt-2 grid grid-cols-4 gap-3;
}
.new-workspace-roles label,
.new-workspace-form .new-workspace-check {
  @apply flex items-center gap-2;
}
.new-workspace-error {
  color: var(--destructive);
  overflow-wrap: anywhere;
}
</style>
