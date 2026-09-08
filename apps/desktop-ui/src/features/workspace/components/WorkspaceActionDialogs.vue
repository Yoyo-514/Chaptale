<script setup lang="ts">
import { computed } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppForm, AppFormActions } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';

import { useWorkspaceActions } from '../actions';
const actions = useWorkspaceActions();
const title = computed(
  () =>
    ({ rename: '重命名', move: '移动文件或目录', duplicate: '复制为新文件', trash: '移到回收站' })[
      actions.pending?.action ?? 'rename'
    ]
);
</script>
<template>
  <AppDialog
    :open="Boolean(actions.pending)"
    :title="title"
    @update:open="open => !open && !actions.busy && (actions.pending = null)"
  >
    <AppForm v-if="actions.pending" class="workspace-action-form" @submit="actions.apply">
      <p class="workspace-action-path">{{ actions.pending.entry.relativePath }}</p>
      <p v-if="actions.pending.action === 'trash'" class="workspace-action-warning">
        {{
          actions.pending.entry.kind === 'directory' ? `此目录包含 ${actions.pending.entry.entries - 1} 个条目。` : ''
        }}文件将移入系统回收站。
      </p>
      <label v-else
        >{{ actions.pending.action === 'rename' ? '新名称' : '目标相对路径' }}
        <AppInput v-model="actions.destination" :disabled="actions.busy" aria-label="文件操作目标" />
      </label>
      <details v-if="actions.affectedLinks.length && actions.pending.action !== 'duplicate'" open>
        <summary>{{ actions.affectedLinks.length }} 个文件的引用可能受影响</summary>
        <ul>
          <li v-for="asset in actions.affectedLinks" :key="asset.sourcePath">{{ asset.sourcePath }}</li>
        </ul>
      </details>
      <p v-if="actions.error" class="workspace-action-error" role="alert">{{ actions.error }}</p>
      <AppFormActions>
        <AppButton :disabled="actions.busy" @click="actions.pending = null">取消</AppButton>
        <AppButton
          type="submit"
          :variant="actions.pending.action === 'trash' ? 'danger' : 'primary'"
          :disabled="actions.busy || (actions.pending.action !== 'trash' && !actions.destination.trim())"
          >{{ title }}</AppButton
        >
      </AppFormActions>
    </AppForm>
  </AppDialog>
</template>
<style scoped lang="scss">
.workspace-action-form {
  @apply grid gap-4 overflow-auto pt-4;
  font-size: var(--ui-font-size);
}
.workspace-action-form label {
  @apply grid gap-2;
}
.workspace-action-path,
.workspace-action-form li {
  overflow-wrap: anywhere;
}
.workspace-action-warning,
.workspace-action-form details {
  color: var(--warning);
}
.workspace-action-error {
  color: var(--destructive);
  overflow-wrap: anywhere;
}
</style>
