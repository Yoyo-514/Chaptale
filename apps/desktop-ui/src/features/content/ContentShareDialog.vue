<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';

import type { ContentImportArgs } from '@chaptale/ipc-contract';
import type { ContentEntry, ContentImportEntry, ContentScope } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppDialog } from '@/components/AppDialog';
import { AppFilePicker } from '@/components/AppFilePicker';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTextarea } from '@/components/AppTextarea';
import { useNotificationStore } from '@/features/notifications';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { toContentRef, useContentStore } from './store';

const props = defineProps<{ open: boolean; mode: 'import' | 'export'; entries: ContentEntry[] }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; saved: [] }>();
const content = useContentStore();
const notifications = useNotificationStore();
const text = ref('');
const filename = ref('');
const scope = ref<ContentScope>('user');
const preview = shallowRef<ContentImportEntry[]>([]);
const chosen = ref<string[]>([]);
const overwrites = ref<string[]>([]);
const active = ref('');
const inspected = ref(false);
const busy = ref(false);
const error = ref('');
const key = (item: { kind: string; id: string }) => `${item.kind}:${item.id}`;
const current = computed(() => preview.value.find(item => key(item) === active.value));
let context: { rootPath?: string } = {};
let generation = 0;
watch(
  () => props.open,
  async open => {
    const token = ++generation;
    if (!open) return;
    context = { ...content.context };
    text.value = '';
    filename.value = '';
    preview.value = [];
    chosen.value = [];
    overwrites.value = [];
    error.value = '';
    inspected.value = false;
    if (props.mode === 'export') {
      busy.value = true;
      try {
        const result = await getDesktopApi().content.previewExport({
          ...context,
          refs: props.entries.map(toContentRef)
        });
        if (token === generation) text.value = result;
      } catch (cause) {
        if (token === generation) error.value = toErrorMessage(cause);
      } finally {
        if (token === generation) busy.value = false;
      }
    }
  }
);
async function loadPreview() {
  const token = ++generation;
  busy.value = true;
  preview.value = [];
  chosen.value = [];
  overwrites.value = [];
  error.value = '';
  try {
    const result = await getDesktopApi().content.previewImport({ ...context, scope: scope.value, text: text.value });
    if (token !== generation) return;
    preview.value = result.entries;
    chosen.value = result.entries.filter(item => !item.conflict).map(key);
    active.value = result.entries[0] ? key(result.entries[0]) : '';
  } catch (cause) {
    if (token === generation) error.value = toErrorMessage(cause);
  } finally {
    if (token === generation) busy.value = false;
  }
}
async function pick(file: File) {
  error.value = '';
  try {
    if (file.size > 4 * 1024 * 1024) throw new Error('分享包不能超过 4 MiB');
    text.value = await file.text();
    filename.value = file.name;
    await loadPreview();
  } catch (cause) {
    error.value = toErrorMessage(cause);
  }
}
function toggle(values: string[], value: string, enabled: boolean) {
  return enabled ? [...new Set([...values, value])] : values.filter(item => item !== value);
}
async function finish() {
  busy.value = true;
  error.value = '';
  try {
    if (props.mode === 'export') {
      const result = await getDesktopApi().content.saveExport({ text: text.value });
      if (!result) return;
      notifications.success('内容包已导出', result);
    } else {
      const result = await getDesktopApi().content.import({
        ...context,
        scope: scope.value,
        text: text.value,
        selected: preview.value
          .filter(item => chosen.value.includes(key(item)))
          .map(item => {
            const choice: ContentImportArgs['selected'][number] = { kind: item.kind, id: item.id };
            if (item.conflict && overwrites.value.includes(key(item)))
              choice.overwrite = toContentRef({ ...item.conflict, name: item.name, effective: true });
            return choice;
          })
      });
      if (result.imported.length) {
        notifications.success(`已导入 ${result.imported.length} 项内容`);
        emit('saved');
      }
      if (result.errors.length) {
        await loadPreview();
        error.value = result.errors.join('\n');
        return;
      }
    }
    emit('update:open', false);
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <AppDialog
    :open="open"
    :title="mode === 'export' ? '导出内容包' : '导入内容包'"
    content-size="lg"
    @update:open="value => !busy && emit('update:open', value)"
  >
    <div class="content-share">
      <template v-if="mode === 'export'">
        <AppTextarea
          :model-value="text"
          class="share-source"
          aria-label="实际导出内容"
          readonly
          :rows="18"
          resize="none"
        />
        <label class="check-row"><AppCheckbox v-model="inspected" />已检查导出全文，不含密钥或私密资料</label>
      </template>
      <template v-else>
        <div class="share-toolbar">
          <AppFilePicker accept=".json,application/json" :disabled="busy" label="选择内容包" @select="pick" />
          <span>{{ filename }}</span>
          <AppSelect
            :model-value="scope"
            aria-label="导入范围"
            :disabled="busy"
            @update:model-value="
              value => {
                scope = value as ContentScope;
                if (text) void loadPreview();
              }
            "
          >
            <AppSelectItem value="user">所有作品</AppSelectItem
            ><AppSelectItem v-if="context.rootPath" value="workspace">当前作品</AppSelectItem>
          </AppSelect>
        </div>
        <div v-if="preview.length" class="import-preview">
          <AppScrollArea class="import-list">
            <div v-for="item in preview" :key="key(item)" class="import-row">
              <label class="check-row"
                ><AppCheckbox
                  :model-value="chosen.includes(key(item))"
                  @update:model-value="chosen = toggle(chosen, key(item), $event === true)"
                />{{ item.id }}</label
              >
              <AppButton variant="link" @click="active = key(item)">{{ item.name }}</AppButton>
              <label v-if="item.conflict" class="check-row"
                ><AppCheckbox
                  :model-value="overwrites.includes(key(item))"
                  @update:model-value="overwrites = toggle(overwrites, key(item), $event === true)"
                />覆盖同名内容</label
              >
            </div>
          </AppScrollArea>
          <div class="import-detail">
            <p v-for="warning in current?.warnings" :key="warning" class="share-warning">{{ warning }}</p>
            <AppTextarea
              :model-value="current?.markdown ?? ''"
              class="share-source"
              aria-label="将导入的完整内容"
              readonly
              :rows="15"
              resize="none"
            />
          </div>
        </div>
      </template>
      <p v-if="error" role="alert">{{ error }}</p>
      <footer>
        <AppButton :disabled="busy" @click="emit('update:open', false)">取消</AppButton>
        <AppButton
          variant="primary"
          :disabled="
            busy ||
            (mode === 'export'
              ? !inspected || !text
              : !chosen.length ||
                preview.some(item => chosen.includes(key(item)) && item.conflict && !overwrites.includes(key(item))))
          "
          @click="finish"
        >
          {{ mode === 'export' ? '导出文件' : `导入所选 (${chosen.length})` }}
        </AppButton>
      </footer>
    </div>
  </AppDialog>
</template>
<style scoped lang="scss">
.content-share {
  @apply flex min-h-0 flex-col gap-3 pt-3;
  font-size: var(--ui-font-size);
}
.share-source {
  @apply min-h-0 flex-1;
  font-family: var(--font-mono, monospace);
}
.check-row {
  @apply flex min-w-0 items-center gap-2;
  overflow-wrap: anywhere;
}
.share-toolbar {
  @apply flex flex-wrap items-center gap-2;
}
.share-toolbar > span {
  @apply min-w-0 flex-1 truncate;
}
.share-toolbar :deep(.app-select-trigger) {
  width: 140px;
}
.import-preview {
  @apply grid min-h-0 gap-3;
  height: min(420px, calc(100vh - 300px));
  grid-template-columns: minmax(180px, 1fr) minmax(0, 2fr);
}
.import-list {
  @apply min-h-0;
}
.import-row {
  @apply flex flex-col gap-2 border-b p-2;
  border-color: var(--border-subtle);
}
.import-row :deep(button) {
  @apply justify-start text-left;
  white-space: normal;
}
.import-detail {
  @apply flex min-h-0 min-w-0 flex-col gap-2;
}
.share-warning {
  @apply m-0;
  color: var(--warning);
}
footer {
  @apply flex shrink-0 justify-end gap-2;
}
[role='alert'] {
  @apply m-0 whitespace-pre-wrap;
  color: var(--destructive);
  overflow-wrap: anywhere;
}
</style>
