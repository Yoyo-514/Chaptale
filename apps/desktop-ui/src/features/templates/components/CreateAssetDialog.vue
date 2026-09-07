<script setup lang="ts">
import { computed, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppInput } from '@/components/AppInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { useEditorStore } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { useFileTreeStore } from '@/features/workspace';

import { useTemplateStore } from '../store';
import TemplateFields from './TemplateFields.vue';
const templates = useTemplateStore();
const editor = useEditorStore();
const library = useLibraryStore();
const tree = useFileTreeStore();
const template = computed(() => templates.templates.find(value => value.template === templates.creating?.templateId));
let suggested = '';
watch(
  () => templates.creating?.templateId,
  templateId => {
    if (templateId) void library.load();
  }
);
watch(
  () => [templates.creating?.templateId, templates.creating?.values.title, templates.creating?.values.order],
  () => {
    if (!templates.creating) return;
    const title = String(templates.creating.values.title ?? '')
      .replace(/[<>:"/\\|?*]/g, '')
      .trim();
    const prefix =
      template.value?.targetKind === 'chapter'
        ? `${String(templates.creating.values.order ?? 1).padStart(4, '0')}-`
        : '';
    const next = `${prefix}${title || '未命名'}.md`;
    if (!templates.creating.filename || templates.creating.filename === suggested) templates.creating.filename = next;
    suggested = next;
  }
);
async function create() {
  const document = await templates.create();
  if (!document) return;
  await tree.reload();
  await library.load();
  await editor.openDocument(document.relativePath);
}
</script>
<template>
  <AppDialog
    :open="Boolean(templates.creating)"
    :title="template?.targetKind === 'scene-card' ? '新建场景卡' : '从模板新建'"
    content-size="lg"
    @update:open="open => !open && !templates.busy && (templates.creating = null)"
  >
    <form v-if="templates.creating" class="create-asset" @submit.prevent="create">
      <label
        >模板<AppSelect
          :model-value="templates.creating.templateId"
          aria-label="资产模板"
          :disabled="templates.loading || templates.busy"
          @update:model-value="templates.choose($event)"
        >
          <AppSelectItem v-for="item in templates.templates" :key="item.template" :value="item.template">
            {{ item.name }} · {{ { builtin: '内置', user: '作者', workspace: '作品' }[item.source] }}
          </AppSelectItem>
        </AppSelect></label
      >
      <p v-if="templates.loading" role="status">正在读取模板</p>
      <TemplateFields
        v-if="template"
        :fields="template.fields"
        :values="templates.creating.values"
        :assets="library.available"
        :disabled="templates.busy"
        @field="(key, value) => templates.creating && (templates.creating.values[key] = value)"
      />
      <label
        >目录<AppInput v-model="templates.creating.directory" aria-label="资产目录" :disabled="templates.busy"
      /></label>
      <label
        >文件名<AppInput
          v-model="templates.creating.filename"
          aria-label="资产文件名"
          :disabled="templates.busy"
          maxlength="160"
      /></label>
      <p v-if="templates.error" role="alert">{{ templates.error }}</p>
      <details v-if="templates.diagnostics.length">
        <summary>模板诊断</summary>
        <p v-for="diagnostic in templates.diagnostics" :key="diagnostic">{{ diagnostic }}</p>
      </details>
      <footer>
        <AppButton size="sm" :disabled="templates.busy" @click="templates.creating = null">取消</AppButton>
        <AppButton type="submit" size="sm" :disabled="!template || templates.busy || templates.loading"
          >创建文件</AppButton
        >
      </footer>
    </form>
  </AppDialog>
</template>
<style scoped lang="scss">
.create-asset {
  @apply flex min-h-0 flex-col gap-4 overflow-auto pt-3;
  font-size: var(--ui-font-size);
  max-height: 75vh;
}
label {
  @apply flex min-w-0 flex-col gap-1.5;
}
footer {
  @apply flex shrink-0 justify-end gap-2;
}
[role='alert'] {
  color: var(--destructive);
}
p {
  overflow-wrap: anywhere;
}
</style>
