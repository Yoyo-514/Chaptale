<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';

import type { ContentDocument, ContentEntry, ContentKind } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppInput } from '@/components/AppInput';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTabs } from '@/components/AppTabs';
import { AppTooltip } from '@/components/AppTooltip';
import { SettingsSectionView as SettingsSection } from '@/features/settings';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import ContentActionDialog from './ContentActionDialog.vue';
import ContentEditorDialog from './ContentEditorDialog.vue';
import ContentShareDialog from './ContentShareDialog.vue';
import { contentKey, toContentRef, useContentStore } from './store';

const content = useContentStore();
const kind = ref('persona');
const search = ref('');
const state = ref('active');
const selected = ref<string[]>([]);
const editing = ref(false);
const document = shallowRef<ContentDocument | null>(null);
const sharing = ref(false);
const shareMode = ref<'import' | 'export'>('import');
const error = ref('');
const actionOpen = ref(false);
const action = ref<'delete' | 'restore'>('delete');
const actionEntry = shallowRef<ContentEntry | null>(null);
const entries = computed(() =>
  content.entries.filter(
    item =>
      item.kind === kind.value &&
      Boolean(item.archived) === (state.value === 'archived') &&
      `${item.id} ${item.name}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())
  )
);
const selectedEntries = computed(() => content.entries.filter(item => selected.value.includes(contentKey(item))));
watch([kind, state], () => (selected.value = []));
watch(
  () => content.entries,
  items => (selected.value = selected.value.filter(key => items.some(item => contentKey(item) === key)))
);
const labels = { builtin: '内置', user: '所有作品', workspace: '当前作品' };
const kinds = [
  { value: 'persona', label: '专员' },
  { value: 'skill', label: '技能' },
  { value: 'template', label: '模板' }
];
onMounted(() => void content.refresh());
async function open(entry: (typeof entries.value)[number]) {
  error.value = '';
  const context = { ...content.context };
  try {
    const read = await getDesktopApi().content.read({ ...context, ref: toContentRef(entry) });
    if (context.rootPath !== content.context.rootPath) return;
    document.value = read;
    editing.value = true;
  } catch (cause) {
    error.value = toErrorMessage(cause);
  }
}
function create() {
  document.value = null;
  editing.value = true;
}
function share(mode: 'import' | 'export') {
  shareMode.value = mode;
  sharing.value = true;
}
function manage(entry: ContentEntry, mode: 'delete' | 'restore') {
  if (content.loading) return;
  actionEntry.value = entry;
  action.value = mode;
  actionOpen.value = true;
}
async function managed(entry: ContentEntry) {
  if (document.value && contentKey(document.value) === contentKey(entry)) editing.value = false;
  await content.refresh();
}
</script>
<template>
  <SettingsSection title="专员与创作内容" title-id="settings-content-title" :scrollable="false">
    <AppTabs v-model="kind" :items="kinds" label="创作内容分类">
      <div class="content-toolbar">
        <AppInput v-model="search" aria-label="筛选创作内容" placeholder="筛选名称或标识"
          ><template #prefix><span class="i-mingcute-search-line size-4" aria-hidden="true" /></template
        ></AppInput>
        <AppSelect v-model="state" aria-label="内容状态" class="content-state">
          <AppSelectItem value="active">未归档</AppSelectItem>
          <AppSelectItem value="archived">已归档</AppSelectItem>
        </AppSelect>
        <AppTooltip text="刷新内容"
          ><AppButton icon variant="ghost" aria-label="刷新内容" :disabled="content.loading" @click="content.refresh"
            ><span class="i-mingcute-refresh-3-line size-4" aria-hidden="true" /></AppButton
        ></AppTooltip>
        <AppButton :disabled="content.loading" @click="create"
          ><span class="i-mingcute-add-line size-4" aria-hidden="true" />新建{{
            kinds.find(item => item.value === kind)?.label
          }}</AppButton
        >
      </div>
      <AppScrollArea class="content-list">
        <p v-if="error || content.error" role="alert">{{ error || content.error }}</p>
        <p v-for="diagnostic in content.diagnostics" :key="diagnostic" role="status">{{ diagnostic }}</p>
        <p v-if="!entries.length">{{ content.loading ? '正在读取内容' : '没有匹配的内容' }}</p>
        <div v-for="entry in entries" :key="contentKey(entry)" class="content-row">
          <AppCheckbox
            :model-value="selected.includes(contentKey(entry))"
            :aria-label="`选择 ${entry.id} ${labels[entry.source]}`"
            @update:model-value="
              selected =
                $event === true
                  ? [...new Set([...selected, contentKey(entry)])]
                  : selected.filter(key => key !== contentKey(entry))
            "
          />
          <AppButton variant="ghost" class="content-item" :disabled="content.loading" @click="open(entry)">
            <strong>{{ entry.name }}</strong
            ><span>{{ entry.id }}</span>
          </AppButton>
          <span class="content-source-label"
            >{{ labels[entry.source]
            }}{{
              entry.archived
                ? ' · 已归档'
                : !entry.effective
                  ? ' · 已覆盖'
                  : entry.persona?.enabled === false
                    ? ' · 停用'
                    : ''
            }}</span
          >
          <div v-if="entry.source !== 'builtin'" class="content-actions">
            <AppTooltip v-if="entry.archived" text="恢复内容">
              <AppButton
                icon
                variant="ghost"
                :disabled="content.loading"
                :aria-label="`恢复 ${entry.name}`"
                @click="manage(entry, 'restore')"
                ><span class="i-mingcute-back-2-line size-4" aria-hidden="true"
              /></AppButton>
            </AppTooltip>
            <AppTooltip text="永久删除">
              <AppButton
                icon
                variant="ghost"
                :disabled="content.loading"
                :aria-label="`永久删除 ${entry.name}`"
                @click="manage(entry, 'delete')"
                ><span class="i-mingcute-delete-2-line size-4" aria-hidden="true"
              /></AppButton>
            </AppTooltip>
          </div>
        </div>
      </AppScrollArea>
      <footer>
        <AppButton @click="share('import')"
          ><span class="i-mingcute-upload-2-line size-4" aria-hidden="true" />导入</AppButton
        >
        <AppButton :disabled="!selectedEntries.length || selectedEntries.length > 50" @click="share('export')"
          ><span class="i-mingcute-download-2-line size-4" aria-hidden="true" />导出所选 ({{
            selectedEntries.length
          }})</AppButton
        >
      </footer>
    </AppTabs>
  </SettingsSection>
  <ContentEditorDialog
    v-model:open="editing"
    :kind="kind as ContentKind"
    :document="document"
    @saved="content.refresh"
    @remove="entry => manage(entry, 'delete')"
  />
  <ContentActionDialog v-model:open="actionOpen" :action="action" :entry="actionEntry" @saved="managed" />
  <ContentShareDialog v-model:open="sharing" :mode="shareMode" :entries="selectedEntries" @saved="content.refresh" />
</template>
<style scoped lang="scss">
.content-toolbar {
  @apply grid min-w-0 shrink-0 items-center gap-2 py-3;
  grid-template-columns: minmax(10rem, 1fr) 7rem auto auto;
}
.content-toolbar :deep(.app-input) {
  @apply min-w-0;
}
.content-toolbar :deep(.content-state) {
  @apply w-28 shrink-0;
}
.content-actions {
  @apply flex shrink-0 items-center gap-1;
}
.content-list {
  @apply min-h-0 flex-1;
}
.content-list p {
  @apply px-2 py-1;
  overflow-wrap: anywhere;
  font-size: var(--ui-font-size);
}
.content-row {
  @apply flex min-w-0 items-center gap-2 border-b px-1;
  border-color: var(--border-subtle);
}
.content-item {
  @apply min-w-0 flex-1 flex-col items-start gap-1 rounded-none px-2 py-3 text-left;
  height: auto;
  white-space: normal;
}
.content-item strong {
  @apply font-medium;
  overflow-wrap: anywhere;
}
.content-item > span {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  overflow-wrap: anywhere;
}
.content-source-label {
  @apply w-22 shrink-0 text-right;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
footer {
  @apply flex shrink-0 justify-end gap-2 border-t pt-3;
  border-color: var(--border-subtle);
}
[role='alert'] {
  color: var(--destructive);
}
@container settings-panel (max-width: 40rem) {
  .content-toolbar {
    grid-template-columns: minmax(0, 1fr) auto auto;
  }
  .content-toolbar :deep(.app-input) {
    grid-column: 1 / -1;
  }
  .content-toolbar :deep(.content-state) {
    width: auto;
  }
}
</style>
