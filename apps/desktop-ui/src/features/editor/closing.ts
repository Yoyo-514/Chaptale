import { onScopeDispose, shallowRef } from 'vue';

import { useCreationStore } from '@/features/creation';
import { getDesktopApi } from '@/utils/desktop-api';
import { registerWorkspaceTransitionGuard } from '@/utils/workspace-transition';

import type { OpenDocuments } from './documents';
import { useReviewStore } from './review/store';
import type { DocumentSaving } from './saving';

/** 离开文稿前的确认：关闭标签、切换作品和关闭窗口都先处理未保存的修改。 */
export function useCloseFlow({ tabs }: OpenDocuments, saving: DocumentSaving) {
  const creation = useCreationStore();
  const review = useReviewStore();
  /** discard 为 false 时只能保存或取消，用于需要正式稿的操作。 */
  const unsavedPrompt = shallowRef<{ titles: string[]; discard: boolean } | null>(null);
  let decision:
    | { promise: Promise<'save' | 'discard' | 'cancel'>; resolve: (value: 'save' | 'discard' | 'cancel') => void }
    | undefined;
  let closing: Promise<void> | undefined;
  let closingApproved = false;

  async function promptUnsaved(titles: string[], discard = true): Promise<'save' | 'discard' | 'cancel'> {
    if (!decision) {
      let resolve!: (choice: 'save' | 'discard' | 'cancel') => void;
      const promise = new Promise<'save' | 'discard' | 'cancel'>(done => {
        resolve = done;
      });
      decision = { promise, resolve };
      unsavedPrompt.value = { titles, discard };
    }
    return decision.promise;
  }

  async function confirmClose(ids = tabs.value.map(tab => tab.id), discard = true): Promise<boolean> {
    await Promise.all(ids.map(id => saving.pendingSave(id)));
    const dirty = tabs.value.filter(tab => ids.includes(tab.id) && tab.dirty);
    if (!dirty.length) return true;
    const choice = await promptUnsaved(
      dirty.map(tab => tab.title),
      discard
    );
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      for (const tab of dirty) if (!(await saving.saveDocument(tab.id))) return false;
    } else {
      for (const tab of dirty) if (!(await saving.discardChanges(tab.id))) return false;
    }
    return !tabs.value.some(tab => ids.includes(tab.id) && tab.dirty);
  }
  function resolveUnsaved(choice: 'save' | 'discard' | 'cancel') {
    decision?.resolve(choice);
    decision = undefined;
    unsavedPrompt.value = null;
  }
  async function prepareSwitch() {
    if (!review.confirmLeave()) return false;
    if (!(await confirmClose())) return false;
    await saving.settled();
    return creation.persistState();
  }
  onScopeDispose(registerWorkspaceTransitionGuard(prepareSwitch));
  function requestWindowClose(): Promise<void> {
    void getDesktopApi().windowControl.completeClose(false);
    closing ??= (async () => {
      if (!(await prepareSwitch())) return;
      closingApproved = true;
      try {
        await getDesktopApi().windowControl.completeClose(true);
      } catch (cause) {
        closingApproved = false;
        throw cause;
      }
    })().finally(() => {
      closing = undefined;
    });
    return closing;
  }
  function handleBeforeUnload(event: BeforeUnloadEvent) {
    if ((saving.hasUnsaved.value || review.hasUnsaved) && !closingApproved) {
      event.preventDefault();
    }
  }

  return { unsavedPrompt, promptUnsaved, confirmClose, resolveUnsaved, requestWindowClose, handleBeforeUnload };
}
