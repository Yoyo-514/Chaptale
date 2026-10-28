<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type {
  Entry,
  ExportFilesInput,
  ExportReport,
  ImportFilesInput,
  ImportPlan,
  ImportReport
} from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppFormActions } from '@/components/AppForm';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { useEditorStore } from '@/features/editor';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { requestCreation, useCreationStore } from '../store';

const creation = useCreationStore();
const editor = useEditorStore();
const busy = ref(false);
const error = ref('');
const plan = ref<ImportPlan>();
const job = ref<ImportFilesInput>();
const imported = ref<ImportReport>();
const exported = ref<ExportReport>();
const workId = ref('');
const section = ref<Entry['section']>('manuscript');
const parentId = ref('root');
const targetEntries = ref<Entry[]>([]);
const target = ref('book');
const format = ref<'txt' | 'markdown'>('txt');
const directory = ref('');
const directories = computed(() =>
  targetEntries.value.filter(item => item.kind === 'directory' && item.section === section.value)
);
watch(
  () => [creation.importOpen, creation.exportOpen],
  async () => {
    if (!creation.importOpen && !creation.exportOpen) return;
    plan.value = undefined;
    job.value = undefined;
    imported.value = undefined;
    exported.value = undefined;
    error.value = '';
    directory.value = '';
    parentId.value = 'root';
    workId.value = creation.workId!;
    section.value = creation.view?.section ?? 'manuscript';
    target.value = editor.activeTab ? 'document' : 'book';
    format.value = editor.activeTab?.format ?? 'txt';
    await loadTarget();
  }
);
async function loadTarget() {
  targetEntries.value = [];
  if (!workId.value) return;
  const id = workId.value;
  try {
    const snapshot = await requestCreation('snapshot', { workId: id });
    if (workId.value === id && snapshot.kind === 'work') targetEntries.value = snapshot.entries;
  } catch (cause) {
    error.value = toErrorMessage(cause);
  }
}
watch(section, () => {
  parentId.value = 'root';
});
async function choose(purpose: 'import-files' | 'import-directory' | 'export-directory') {
  busy.value = true;
  error.value = '';
  try {
    const paths = await getDesktopApi().creation.selectPaths(purpose);
    if (!paths) return;
    if (purpose === 'export-directory') directory.value = paths[0]!;
    else plan.value = await requestCreation('prepareImport', { paths });
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
async function runImport() {
  busy.value = true;
  error.value = '';
  try {
    job.value ??= {
      ...plan.value!,
      workId: workId.value,
      section: section.value,
      parentId: parentId.value === 'root' ? null : parentId.value
    };
    imported.value = await requestCreation(
      'importFiles',
      structuredClone({
        ...job.value,
        entries: job.value.entries.map(entry => ({ ...entry })),
        skippedPaths: [...job.value.skippedPaths]
      })
    );
    await creation.refreshEntries();
    await creation.refreshLibrary();
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
async function openImported() {
  if (!(await creation.openWork(workId.value))) return;
  const first = imported.value!.entries.find(entry => entry.kind === 'document');
  if (first) await editor.openDocument(first.id);
  creation.importOpen = false;
}
async function runExport() {
  busy.value = true;
  error.value = '';
  exported.value = undefined;
  try {
    const input: ExportFilesInput = {
      workId: workId.value,
      directory: directory.value,
      target:
        target.value === 'book'
          ? { kind: 'book' }
          : target.value === 'document'
            ? { kind: 'document', documentId: editor.activeTab!.id, format: format.value }
            : { kind: 'manuscript', format: format.value }
    };
    if (!(await editor.confirmClose())) return;
    exported.value = await requestCreation('exportFiles', input);
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
function depth(index: number) {
  let level = 0;
  let parent = plan.value!.entries[index]!.parentIndex;
  while (parent !== null) {
    level += 1;
    parent = plan.value!.entries[parent]!.parentIndex;
  }
  return level;
}
</script>

<template>
  <AppDialog
    :open="creation.importOpen"
    title="导入文稿与资料"
    @update:open="
      open => {
        if (!busy) creation.importOpen = open;
      }
    "
  >
    <div class="exchange-form">
      <template v-if="creation.works.length">
        <div class="exchange-target">
          <label
            >内容区域<AppSelect v-model="section" aria-label="导入内容区域" :disabled="busy || Boolean(job)"
              ><AppSelectItem value="manuscript">文稿</AppSelectItem
              ><AppSelectItem value="resource">资料</AppSelectItem></AppSelect
            ></label
          >
          <label
            >目标目录<AppSelect v-model="parentId" aria-label="导入目标目录" :disabled="busy || Boolean(job)"
              ><AppSelectItem value="root">根目录</AppSelectItem
              ><AppSelectItem v-for="entry in directories" :key="entry.id" :value="entry.id">{{
                entry.title
              }}</AppSelectItem></AppSelect
            ></label
          >
        </div>
        <div class="exchange-actions">
          <AppButton :disabled="busy || Boolean(job)" @click="choose('import-files')">选择文件</AppButton
          ><AppButton :disabled="busy || Boolean(job)" @click="choose('import-directory')">选择目录</AppButton>
        </div>
        <div v-if="plan" class="import-preview" aria-label="导入预览">
          <p>将建立 {{ plan.entries.length }} 个条目。原文件保留，正文按 UTF-8 完整导入。</p>
          <ul>
            <li
              v-for="(entry, index) in plan.entries"
              :key="entry.sourcePath"
              :style="{ paddingLeft: `${depth(index) * 16}px` }"
              :title="entry.sourcePath"
            >
              <span
                :class="entry.kind === 'directory' ? 'i-mingcute-folder-line' : 'i-mingcute-file-line'"
                aria-hidden="true"
              />{{ entry.title }}
            </li>
          </ul>
          <details v-if="plan.skippedPaths.length">
            <summary>跳过 {{ plan.skippedPaths.length }} 个路径</summary>
            <p v-for="path in plan.skippedPaths" :key="path">{{ path }}</p>
          </details>
        </div>
        <div v-if="imported" role="status">
          <p>已导入 {{ imported.entries.length }} 个条目。</p>
          <p v-if="imported.failure" class="exchange-error">{{ imported.failure.message }}。可用同一计划继续导入。</p>
        </div>
      </template>
      <template v-else
        ><p>先创建一部作品，再选择要导入的文稿或资料。</p>
        <AppButton
          @click="
            creation.importOpen = false;
            creation.newWorkOpen = true;
          "
          >新建作品</AppButton
        ></template
      >
      <p v-if="error" role="alert" class="exchange-error">{{ error }}</p>
      <AppFormActions>
        <AppButton :disabled="busy" @click="creation.importOpen = false">关闭</AppButton>
        <AppButton v-if="imported?.entries.length" :disabled="busy" @click="openImported">查看已导入内容</AppButton>
        <AppButton
          v-if="plan && (!imported || imported.failure)"
          variant="primary"
          :disabled="busy || !plan.entries.length"
          @click="runImport"
          >{{ busy ? '正在导入…' : imported ? '继续导入' : '确认导入' }}</AppButton
        >
      </AppFormActions>
    </div>
  </AppDialog>
  <AppDialog
    :open="creation.exportOpen"
    title="导出正文"
    @update:open="
      open => {
        if (!busy) creation.exportOpen = open;
      }
    "
  >
    <div class="exchange-form">
      <label
        >导出范围<AppSelect v-model="target" aria-label="导出范围" :disabled="busy"
          ><AppSelectItem v-if="editor.activeTab" value="document">当前文档</AppSelectItem
          ><AppSelectItem value="manuscript">文稿分别导出</AppSelectItem
          ><AppSelectItem value="book">整本合并 TXT</AppSelectItem></AppSelect
        ></label
      >
      <label v-if="target !== 'book'"
        >格式<AppSelect v-model="format" aria-label="导出格式" :disabled="busy"
          ><AppSelectItem value="txt">TXT</AppSelectItem
          ><AppSelectItem value="markdown">Markdown</AppSelectItem></AppSelect
        ></label
      >
      <div class="exchange-actions">
        <AppButton :disabled="busy" @click="choose('export-directory')">选择导出目录</AppButton
        ><span>{{ directory || '请选择保存位置' }}</span>
      </div>
      <p v-if="target === 'manuscript'">保留卷和嵌套目录层级，每份文稿的标题放在正文前。</p>
      <p v-else-if="target === 'book'">按文稿树顺序合并卷标题、章节标题与正文。</p>
      <p v-else>当前文档的标题放在正文前，正文内容保持原样。</p>
      <p>同名文件或目录追加编号，已有内容保留。</p>
      <div v-if="exported" role="status">
        <p>{{ exported.failure ? '导出未完成，已输出' : '已导出' }} {{ exported.paths.length }} 个文件。</p>
        <ul class="export-paths">
          <li v-for="path in exported.paths" :key="path">{{ path }}</li>
        </ul>
        <p v-if="exported.failure" role="alert" class="exchange-error">{{ exported.failure.message }}</p>
      </div>
      <p v-if="error" class="exchange-error" role="alert">{{ error }}</p>
      <AppFormActions
        ><AppButton :disabled="busy" @click="creation.exportOpen = false">关闭</AppButton
        ><AppButton variant="primary" :disabled="busy || !directory" @click="runExport">{{
          busy ? '正在导出…' : '导出'
        }}</AppButton></AppFormActions
      >
    </div>
  </AppDialog>
</template>

<style scoped>
.exchange-form {
  display: grid;
  gap: 12px;
  padding: 12px 0 0;
  font-size: 13px;
}
.exchange-form label {
  display: grid;
  gap: 6px;
}
.exchange-target {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.exchange-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.exchange-actions span {
  overflow-wrap: anywhere;
}
p {
  margin: 0;
  color: var(--muted-foreground);
  line-height: 1.6;
}
.import-preview {
  max-height: 280px;
  overflow: auto;
}
.import-preview ul {
  list-style: none;
  padding: 8px 0;
  margin: 0;
}
.import-preview li {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  overflow-wrap: anywhere;
}
.import-preview li span {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}
.exchange-error {
  color: var(--destructive);
}
.export-paths {
  max-height: 200px;
  overflow: auto;
  padding-left: 20px;
  overflow-wrap: anywhere;
}
</style>
