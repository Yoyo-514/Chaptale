<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';

import type { ContentDeletePreview, ContentEntry } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppScrollArea } from '@/components/AppScrollArea';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { toContentRef, useContentStore } from './store';

const props = defineProps<{ open: boolean; action: 'delete' | 'restore'; entry: ContentEntry | null }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; saved: [entry: ContentEntry] }>();
const content = useContentStore();
const preview = shallowRef<ContentDeletePreview | null>(null);
const busy = ref(false);
const error = ref('');
const title = computed(() => (props.action === 'delete' ? '永久删除此内容？' : '恢复已归档内容？'));
const labels = { builtin: '内置', user: '所有作品', workspace: '当前作品' };
let context: { rootPath?: string } = {};
watch(
  () => props.open,
  async (open, _previous, onCleanup) => {
    if (!open || !props.entry) return;
    let current = true;
    onCleanup(() => (current = false));
    context = { ...content.context };
    error.value = '';
    preview.value = null;
    if (props.action !== 'delete') return;
    busy.value = true;
    try {
      const result = await getDesktopApi().content.previewDelete({ ...context, ref: toContentRef(props.entry) });
      if (current) preview.value = result;
    } catch (cause) {
      if (current) error.value = toErrorMessage(cause);
    } finally {
      if (current) busy.value = false;
    }
  }
);
function close() {
  if (!busy.value) emit('update:open', false);
}
async function confirm() {
  if (!props.entry || busy.value) return;
  const entry = props.entry;
  busy.value = true;
  error.value = '';
  try {
    const args = { ...context, ref: toContentRef(entry) };
    if (props.action === 'delete') {
      if (!preview.value) return;
      await getDesktopApi().content.delete({ ...args, fingerprint: preview.value.fingerprint });
    } else await getDesktopApi().content.restore(args);
    emit('saved', entry);
    emit('update:open', false);
  } catch (cause) {
    error.value = toErrorMessage(cause);
    preview.value = null;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <AppDialog
    :open="open"
    :title="title"
    :description="
      action === 'delete'
        ? '不会进入回收站，无法撤销。此内容尚未保存的修改也不会保留。'
        : '恢复到原存放范围的默认文件名，不覆盖已有内容。'
    "
    @update:open="value => !value && close()"
  >
    <div class="content-action">
      <div v-if="entry" class="content-action-identity">
        <strong>{{ entry.name }}</strong>
        <span>{{ entry.id }} · {{ labels[entry.source] }}{{ entry.archived ? ' · 已归档' : '' }}</span>
      </div>
      <template v-if="preview">
        <p>{{ preview.files.length }} 个文件 · {{ (preview.bytes / 1024).toFixed(1) }} KiB</p>
        <AppScrollArea class="content-action-files">
          <ul>
            <li v-for="file in preview.files" :key="file.path">{{ file.path }}</li>
          </ul>
        </AppScrollArea>
        <p v-for="warning in preview.warnings" :key="warning">{{ warning }}</p>
      </template>
      <p v-else-if="busy" role="status">正在检查文件范围</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <footer>
        <AppButton :disabled="busy" @click="close">{{ error ? '关闭' : '取消' }}</AppButton>
        <AppButton
          :variant="action === 'delete' ? 'danger' : 'primary'"
          :disabled="busy || (action === 'delete' && !preview)"
          @click="confirm"
          >{{ action === 'delete' ? '永久删除' : '恢复内容' }}</AppButton
        >
      </footer>
    </div>
  </AppDialog>
</template>
<style scoped lang="scss">
.content-action {
  @apply flex min-h-0 flex-col gap-3 pt-4;
  font-size: var(--ui-font-size);
}
.content-action-identity {
  @apply flex min-w-0 flex-col gap-1;
}
.content-action-identity span {
  color: var(--muted-foreground);
}
.content-action p {
  @apply m-0;
}
.content-action-files {
  @apply min-h-0;
  max-height: 180px;
}
.content-action ul {
  @apply m-0 pl-5;
}
.content-action li,
.content-action span,
.content-action strong,
.content-action p {
  overflow-wrap: anywhere;
}
footer {
  @apply flex justify-end gap-2 pt-1;
}
[role='alert'] {
  color: var(--destructive);
}
</style>
