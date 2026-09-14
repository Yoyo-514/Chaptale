import { computed, ref, watch } from 'vue';

import type { WorkspaceDocument } from '@chaptale/ipc-contract';
import { matchAssetTemplate, validateTemplateValues, type AssetFieldValue } from '@chaptale/shared';
import { parseDocumentFrontmatter, patchDocumentFields } from '@chaptale/shared/document-frontmatter';

import { useLibraryStore } from '@/features/library';
import { useTemplateStore } from '@/features/templates';
import { toErrorMessage } from '@/utils/desktop-api';

import type { DocumentBuffer } from '../codemirror/document-buffer';

type FormDocument = {
  document: WorkspaceDocument;
  buffer?: DocumentBuffer;
  saving?: boolean;
  readonly: boolean;
  conflict?: boolean;
};

/** 表单编辑仍进入正文缓冲的同一个撤销事务，不维护第二份可保存的文档副本。 */
export function useDocumentForm(props: FormDocument, onChange: (buffer: DocumentBuffer) => void, foldHead: () => void) {
  const templates = useTemplateStore();
  const library = useLibraryStore();
  const showForm = ref(false);
  const formValues = ref<Record<string, unknown>>({});
  const formError = ref('');
  const assetTemplate = computed(() =>
    props.document.head.status === 'ok'
      ? matchAssetTemplate(templates.templates, props.document.head.frontmatter)
      : undefined
  );

  function syncForm() {
    const head = parseDocumentFrontmatter(props.buffer?.content ?? props.document.content);
    formValues.value = head.status === 'ok' ? head.frontmatter : {};
  }

  function changeField(key: string, value: AssetFieldValue) {
    if (!props.buffer || props.saving || props.readonly || props.conflict || !assetTemplate.value) return;
    try {
      const errors = validateTemplateValues(assetTemplate.value, { [key]: value }, false);
      if (errors.length) throw new Error(errors.join('\n'));
      props.buffer.replaceContent(patchDocumentFields(props.buffer.content, { [key]: value }));
      foldHead();
      onChange(props.buffer);
      syncForm();
      formError.value = '';
    } catch (error) {
      formError.value = toErrorMessage(error);
    }
  }

  watch(showForm, () => {
    syncForm();
    if (showForm.value) {
      foldHead();
      if (!library.snapshot) void library.load();
    }
  });
  watch(() => props.document.contentHash, syncForm);
  return { showForm, formValues, formError, assetTemplate, syncForm, changeField };
}
