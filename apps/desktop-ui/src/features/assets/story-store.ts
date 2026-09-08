import { defineStore } from 'pinia';
import { computed, ref, shallowRef, toRaw, watch } from 'vue';

import type { WorkspaceDocument } from '@chaptale/ipc-contract';
import { matchAssetTemplate, type AssetFieldValue, type AssetRecord, type AssetTemplate } from '@chaptale/shared';

import { useEditorStore } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { useTemplateStore } from '@/features/templates';
import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { patchRelationship, patchStoryEvent } from './story-files';
import { isPublicAsset, type CharacterConnection } from './story-model';

async function readStoryDocument(path: string, rootPath: string) {
  const result = await getDesktopApi().workspace.readDocument({ rootPath, relativePath: path });
  if (!result.ok) throw new Error(result.message);
  return result.document;
}

export const useStoryStore = defineStore('story-assets', () => {
  const workspace = useWorkspaceStore();
  const editor = useEditorStore();
  const library = useLibraryStore();
  const templates = useTemplateStore();
  const characters = computed(() => library.assets.filter(asset => isPublicAsset(asset) && asset.kind === 'character'));
  const error = ref('');
  const busy = ref(false);
  const loading = ref(false);
  const relation = ref<{
    sourcePath: string;
    targetPath: string;
    index: number | null;
    type: string;
    note: string;
    removing: boolean;
  } | null>(null);
  const relationDocument = shallowRef<WorkspaceDocument | null>(null);
  const event = ref<{ values: Record<string, AssetFieldValue> } | null>(null);
  const eventDocument = shallowRef<WorkspaceDocument | null>(null);
  const eventTemplate = shallowRef<AssetTemplate | null>(null);
  let sequence = 0;
  async function selectSource(sourcePath: string, expectedHash?: string) {
    const rootPath = workspace.rootPath;
    if (!relation.value || !rootPath) return;
    relation.value.sourcePath = sourcePath;
    relationDocument.value = null;
    error.value = '';
    const token = ++sequence;
    loading.value = true;
    try {
      if (!characters.value.some(asset => asset.sourcePath === sourcePath)) return;
      const document = await readStoryDocument(sourcePath, rootPath);
      if (token !== sequence || rootPath !== workspace.rootPath) return;
      if (document.head.status !== 'ok' || document.head.frontmatter.kind !== 'character')
        throw new Error('请选择有效角色文件');
      if (expectedHash && document.contentHash !== expectedHash)
        throw new Error('角色文件已变化，请刷新后重新编辑关系');
      relationDocument.value = document;
    } catch (cause) {
      if (token === sequence) error.value = toErrorMessage(cause);
    } finally {
      if (token === sequence) loading.value = false;
    }
  }
  async function newRelation(sourcePath = characters.value[0]?.sourcePath ?? '', targetPath = '') {
    error.value = '';
    relation.value = { sourcePath, targetPath, index: null, type: '', note: '', removing: false };
    await selectSource(sourcePath);
  }
  async function editRelation(connection: CharacterConnection) {
    relation.value = {
      sourcePath: connection.source.sourcePath,
      targetPath: connection.target?.sourcePath ?? connection.to,
      index: connection.index,
      type: connection.type,
      note: connection.note,
      removing: false
    };
    await selectSource(connection.source.sourcePath, connection.source.contentHash);
  }
  async function persist(document: WorkspaceDocument, content: string) {
    await editor.acceptDocumentChange(document.relativePath, document.contentHash, async () => {
      const result = await getDesktopApi().workspace.writeDocument({
        rootPath: document.rootPath,
        relativePath: document.relativePath,
        expectedHash: document.contentHash,
        content
      });
      if (!result.ok) throw new Error(result.message);
      return { document: result.document };
    });
    if (document.rootPath === workspace.rootPath) await library.load();
  }
  async function saveRelation() {
    const draft = relation.value;
    const document = relationDocument.value;
    if (!draft || !document || busy.value || loading.value || document.rootPath !== workspace.rootPath) return;
    busy.value = true;
    error.value = '';
    try {
      if (
        !draft.removing &&
        (!characters.value.some(asset => asset.sourcePath === draft.targetPath) ||
          draft.targetPath === draft.sourcePath)
      )
        throw new Error('请选择另一位目标角色');
      await persist(
        document,
        patchRelationship(
          document.content,
          draft.index,
          draft.removing
            ? null
            : {
                to: `[[${draft.targetPath}]]`,
                type: draft.type,
                note: draft.note
              }
        )
      );
      if (document.rootPath === workspace.rootPath) relation.value = null;
    } catch (cause) {
      if (document.rootPath === workspace.rootPath) error.value = toErrorMessage(cause);
    } finally {
      if (document.rootPath === workspace.rootPath) busy.value = false;
    }
  }
  async function editEvent(asset: AssetRecord) {
    const rootPath = workspace.rootPath;
    if (!rootPath) return;
    error.value = '';
    event.value = { values: {} };
    eventDocument.value = null;
    eventTemplate.value = null;
    loading.value = true;
    const token = ++sequence;
    try {
      await templates.load();
      const document = await readStoryDocument(asset.sourcePath, rootPath);
      if (token !== sequence || rootPath !== workspace.rootPath) return;
      if (document.contentHash !== asset.contentHash) throw new Error('事件已变化，请刷新后重新打开');
      if (document.head.status !== 'ok' || document.head.frontmatter.kind !== 'timeline-event')
        throw new Error('请选择有效事件文件');
      const template = matchAssetTemplate(templates.templates, document.head.frontmatter);
      if (!template) throw new Error('事件模板不可用，请打开源文件编辑');
      eventDocument.value = document;
      eventTemplate.value = template;
      event.value = {
        values: Object.fromEntries(
          template.fields.map(field => [
            field.key,
            document.head.status === 'ok' ? (document.head.frontmatter[field.key] ?? field.default ?? null) : null
          ])
        ) as Record<string, AssetFieldValue>
      };
    } catch (cause) {
      if (token === sequence) error.value = toErrorMessage(cause);
    } finally {
      if (token === sequence) loading.value = false;
    }
  }
  async function saveEvent() {
    const document = eventDocument.value;
    const template = eventTemplate.value;
    if (!event.value || !document || !template || busy.value || document.rootPath !== workspace.rootPath) return;
    busy.value = true;
    error.value = '';
    try {
      const values = structuredClone(toRaw(event.value.values));
      await persist(document, patchStoryEvent(document.content, values, template));
      if (document.rootPath === workspace.rootPath) event.value = null;
    } catch (cause) {
      if (document.rootPath === workspace.rootPath) error.value = toErrorMessage(cause);
    } finally {
      if (document.rootPath === workspace.rootPath) busy.value = false;
    }
  }
  function closeRelation() {
    if (busy.value) return;
    ++sequence;
    relation.value = null;
    relationDocument.value = null;
    loading.value = false;
  }
  function closeEvent() {
    if (busy.value) return;
    ++sequence;
    event.value = null;
    eventDocument.value = null;
    loading.value = false;
  }
  const sourceName = computed(
    () => characters.value.find(asset => asset.sourcePath === relation.value?.sourcePath)?.title ?? ''
  );
  watch(
    () => workspace.revision,
    () => {
      ++sequence;
      relation.value = null;
      event.value = null;
      relationDocument.value = null;
      eventDocument.value = null;
      loading.value = false;
      busy.value = false;
      error.value = '';
    }
  );
  return {
    characters,
    relation,
    relationDocument,
    event,
    eventDocument,
    eventTemplate,
    sourceName,
    error,
    busy,
    loading,
    newRelation,
    selectSource,
    editRelation,
    saveRelation,
    editEvent,
    saveEvent,
    closeRelation,
    closeEvent
  };
});
