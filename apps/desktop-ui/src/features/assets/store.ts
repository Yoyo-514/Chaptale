import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';

import type { MemoryPendingDetails, MemoryPendingProposal } from '@chaptale/shared';

import { useEditorStore } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { useSettlementStore } from '@/features/settlement';
import { useTemplateStore } from '@/features/templates';
import { useWorkbenchStore } from '@/features/workbench';
import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import type { AssetViewId } from './presentation';

export const useAssetStore = defineStore('assets', () => {
  const workspace = useWorkspaceStore();
  const editor = useEditorStore();
  const library = useLibraryStore();
  const templates = useTemplateStore();
  const settlement = useSettlementStore();
  const navigation = useWorkbenchStore();
  const view = ref<AssetViewId>('chapters');
  const mode = ref<'directory' | 'grouped'>('directory');
  const query = ref('');
  const includeArchived = ref(false);
  const proposals = shallowRef<MemoryPendingProposal[]>([]);
  const pending = shallowRef<MemoryPendingDetails | null>(null);
  const busy = ref(false);
  const error = ref('');
  let sequence = 0;
  let detailSequence = 0;
  const current = computed(() => library.assets.find(asset => asset.sourcePath === editor.activeTab?.path));
  const currentProposals = computed(() =>
    proposals.value.filter(proposal => proposal.targetPath === editor.activeTab?.path)
  );
  const currentBatches = computed(() =>
    settlement.batches.filter(batch => batch.targets.includes(editor.activeTab?.path ?? ''))
  );

  async function refresh() {
    const rootPath = workspace.rootPath;
    if (!rootPath) return;
    const token = ++sequence;
    try {
      await library.load();
      if (rootPath !== workspace.rootPath) return;
      const result = await getDesktopApi().memory.listPending();
      if (token !== sequence || rootPath !== workspace.rootPath) return;
      proposals.value = result.proposals;
      error.value = result.diagnostics.map(item => item.message).join('\n');
      await settlement.refresh();
    } catch (cause) {
      if (token === sequence) error.value = toErrorMessage(cause);
    }
  }
  async function open(sourcePath: string) {
    await editor.openDocument(sourcePath);
    navigation.auxiliary = 'assets';
  }
  async function identify(templateId: string) {
    const tab = editor.activeTab;
    const template = templates.templates.find(item => item.template === templateId);
    const rootPath = workspace.rootPath;
    if (!tab?.document || !template || !rootPath || busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      await editor.acceptDocumentChange(tab.path, tab.document.contentHash, async () => ({
        document: await getDesktopApi().templates.identify({
          rootPath,
          relativePath: tab.path,
          expectedHash: tab.document!.contentHash,
          templateId,
          templateHash: template.hash
        })
      }));
      if (rootPath === workspace.rootPath) await refresh();
    } catch (cause) {
      if (rootPath === workspace.rootPath) error.value = toErrorMessage(cause);
    } finally {
      if (rootPath === workspace.rootPath) busy.value = false;
    }
  }
  async function inspect(id: string) {
    const rootPath = workspace.rootPath;
    if (!rootPath) return;
    const token = ++detailSequence;
    try {
      const result = await getDesktopApi().memory.inspectPending({ id, rootPath });
      if (rootPath !== workspace.rootPath || token !== detailSequence) return;
      pending.value = result;
      error.value = '';
    } catch (cause) {
      if (token === detailSequence) error.value = toErrorMessage(cause);
    }
  }
  async function resolve(action: 'accept' | 'reject') {
    const detail = pending.value;
    const rootPath = workspace.rootPath;
    if (!detail || !rootPath || busy.value) return;
    busy.value = true;
    const apply = async () => {
      const result = await getDesktopApi().memory.resolvePending({
        id: detail.proposal.id,
        rootPath,
        action,
        expectedProposalHash: detail.proposalHash
      });
      if (result.status !== (action === 'accept' ? 'applied' : 'rejected'))
        throw new Error(result.message ?? '提议未被应用');
    };
    try {
      if (action === 'accept' && detail.proposal.proposalType !== 'create') {
        const saved = await getDesktopApi().workspace.readDocument({
          rootPath,
          relativePath: detail.proposal.targetPath
        });
        if (!saved.ok) throw new Error(saved.message);
        if (saved.document.content !== detail.original) throw new Error('文件已变化，请重新查看差异');
        await editor.acceptDocumentChange(detail.proposal.targetPath, saved.document.contentHash, async () => {
          await apply();
          const updated = await getDesktopApi().workspace.readDocument({
            rootPath,
            relativePath: detail.proposal.targetPath
          });
          if (!updated.ok) throw new Error(updated.message);
          return { document: updated.document };
        });
      } else await apply();
      if (rootPath === workspace.rootPath) {
        pending.value = null;
        error.value = '';
        await refresh();
      }
    } catch (cause) {
      if (rootPath === workspace.rootPath) error.value = toErrorMessage(cause);
    } finally {
      if (rootPath === workspace.rootPath) busy.value = false;
    }
  }
  watch(
    () => workspace.rootPath,
    () => {
      ++sequence;
      ++detailSequence;
      proposals.value = [];
      pending.value = null;
      busy.value = false;
      error.value = '';
      query.value = '';
    }
  );
  return {
    view,
    mode,
    query,
    includeArchived,
    current,
    currentProposals,
    currentBatches,
    proposals,
    pending,
    busy,
    error,
    refresh,
    open,
    identify,
    inspect,
    resolve
  };
});
