import { defineStore } from 'pinia';
import { ref, shallowRef, toRaw, watch } from 'vue';

import {
  templateDefaults,
  templateSubdirectory,
  type AssetTemplate,
  type AssetFieldValue,
  type WorkspaceLayout
} from '@chaptale/shared';

import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

export const useTemplateStore = defineStore('templates', () => {
  const workspace = useWorkspaceStore();
  const templates = shallowRef<AssetTemplate[]>([]);
  const diagnostics = ref<string[]>([]);
  const layout = shallowRef<WorkspaceLayout | null>(null);
  const error = ref('');
  const loading = ref(false);
  const busy = ref(false);
  const creating = ref<{
    templateId: string;
    values: Record<string, AssetFieldValue>;
    filename: string;
    directory: string;
  } | null>(null);
  let sequence = 0;
  async function load() {
    const rootPath = workspace.rootPath;
    if (!rootPath) return;
    const token = ++sequence;
    loading.value = true;
    try {
      const [result, directories] = await Promise.all([
        getDesktopApi().templates.list({ rootPath }),
        getDesktopApi().workspace.getLayout({ rootPath })
      ]);
      if (token !== sequence || rootPath !== workspace.rootPath) return;
      templates.value = result.templates;
      diagnostics.value = result.diagnostics;
      layout.value = directories.ok ? directories.layout : null;
      error.value = directories.ok ? '' : directories.message;
    } catch (cause) {
      if (token === sequence) error.value = toErrorMessage(cause);
    } finally {
      if (token === sequence) loading.value = false;
    }
  }
  function choose(templateId: string, initial: Record<string, AssetFieldValue> = {}) {
    const template = templates.value.find(value => value.template === templateId);
    if (!template || !layout.value) return;
    creating.value = {
      templateId,
      values: { ...templateDefaults(template), ...initial },
      filename: '',
      directory: `${layout.value.roles[template.targetRole].relativePath}${templateSubdirectory(template.template)}`
    };
  }
  async function openCreate(templateId = 'chapter', initial: Record<string, AssetFieldValue> = {}) {
    const rootPath = workspace.rootPath;
    creating.value = { templateId, values: initial, filename: '', directory: '' };
    await load();
    if (rootPath === workspace.rootPath && creating.value) choose(templateId, initial);
  }
  async function create() {
    const request = creating.value;
    const rootPath = workspace.rootPath;
    const template = templates.value.find(value => value.template === request?.templateId);
    if (!request || !rootPath || !template || busy.value) return;
    busy.value = true;
    try {
      const document = await getDesktopApi().templates.create({
        rootPath,
        templateId: template.template,
        templateHash: template.hash,
        filename: request.filename,
        directory: request.directory,
        values: structuredClone(toRaw(request.values))
      });
      if (rootPath !== workspace.rootPath) return;
      creating.value = null;
      error.value = '';
      return document;
    } catch (cause) {
      if (rootPath === workspace.rootPath) error.value = toErrorMessage(cause);
    } finally {
      busy.value = false;
    }
  }
  watch(
    () => workspace.rootPath,
    () => {
      ++sequence;
      templates.value = [];
      diagnostics.value = [];
      layout.value = null;
      creating.value = null;
      error.value = '';
      loading.value = false;
    }
  );
  return { templates, diagnostics, layout, creating, loading, busy, error, load, choose, openCreate, create };
});
