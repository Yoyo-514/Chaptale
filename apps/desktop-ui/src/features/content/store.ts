import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';

import { reviewerOption, type ContentEntry, type ContentRef } from '@chaptale/shared';

import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

export const contentKey = (entry: Pick<ContentEntry, 'source' | 'kind' | 'sourcePath'>) =>
  `${entry.source}:${entry.kind}:${entry.sourcePath}`;
export function toContentRef(entry: ContentEntry): ContentRef {
  return {
    kind: entry.kind,
    id: entry.id,
    source: entry.source,
    sourcePath: entry.sourcePath,
    hash: entry.hash,
    ...(entry.archived ? { archived: true } : {})
  };
}
export const useContentStore = defineStore('content', () => {
  const workspace = useWorkspaceStore();
  const entries = shallowRef<ContentEntry[]>([]);
  const diagnostics = ref<string[]>([]);
  const error = ref('');
  const loading = ref(false);
  const context = computed(() => (workspace.rootPath ? { rootPath: workspace.rootPath } : {}));
  const personas = computed(() =>
    entries.value.filter(entry => entry.effective && entry.persona).map(entry => entry.persona!)
  );
  const chats = computed(() =>
    personas.value.filter(persona => persona.execution === 'chat' && persona.enabled !== false)
  );
  const reviewers = computed(() =>
    personas.value.flatMap(persona => {
      const option = reviewerOption(persona);
      return option ? [option] : [];
    })
  );
  let generation = 0;
  async function refresh() {
    const token = ++generation;
    loading.value = true;
    try {
      const result = await getDesktopApi().content.list({ ...context.value });
      if (token !== generation) return;
      entries.value = result.entries;
      diagnostics.value = result.diagnostics;
      error.value = '';
    } catch (cause) {
      if (token === generation) error.value = toErrorMessage(cause);
    } finally {
      if (token === generation) loading.value = false;
    }
  }
  watch(
    () => workspace.rootPath,
    () => {
      ++generation;
      entries.value = [];
      diagnostics.value = [];
      error.value = '';
      loading.value = false;
    }
  );
  return { entries, diagnostics, error, loading, context, personas, chats, reviewers, refresh };
});
