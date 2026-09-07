import { defineStore } from 'pinia';
import { ref, shallowRef, watch } from 'vue';

import type { ReviewFeedbackList, ReviewFeedbackSuggestion } from '@chaptale/shared';

import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

export const useReviewFeedbackStore = defineStore('review-feedback', () => {
  const workspace = useWorkspaceStore();
  const data = shallowRef<ReviewFeedbackList>({ suggestions: [], preferences: [], diagnostics: [] });
  const confirmation = shallowRef<ReviewFeedbackSuggestion | null>(null);
  const text = ref('');
  const busy = ref(false);
  const error = ref('');
  let sequence = 0;
  let workspaceEpoch = 0;
  async function refresh() {
    const rootPath = workspace.rootPath;
    if (!rootPath || busy.value) return;
    const token = ++sequence;
    try {
      const result = await getDesktopApi().reviews.feedback({ rootPath });
      if (token === sequence && rootPath === workspace.rootPath) {
        data.value = result;
        error.value = '';
      }
    } catch (cause) {
      if (token === sequence) error.value = toErrorMessage(cause);
    }
  }
  function prepare(suggestion: ReviewFeedbackSuggestion) {
    confirmation.value = suggestion;
    text.value = suggestion.text;
  }
  async function resolve(suggestionId: string, action: 'accept' | 'dismiss') {
    const rootPath = workspace.rootPath;
    if (!rootPath || busy.value) return;
    const epoch = workspaceEpoch;
    busy.value = true;
    ++sequence;
    try {
      const result = await getDesktopApi().reviews.resolveFeedback({
        rootPath,
        suggestionId,
        action,
        ...(action === 'accept' ? { text: text.value } : {})
      });
      if (epoch !== workspaceEpoch) return;
      data.value = result;
      confirmation.value = null;
      error.value = '';
    } catch (cause) {
      if (epoch === workspaceEpoch) error.value = toErrorMessage(cause);
    } finally {
      if (epoch === workspaceEpoch) busy.value = false;
    }
  }
  watch(
    () => workspace.rootPath,
    () => {
      ++sequence;
      ++workspaceEpoch;
      data.value = { suggestions: [], preferences: [], diagnostics: [] };
      confirmation.value = null;
      busy.value = false;
      error.value = '';
      void refresh();
    }
  );
  return { data, confirmation, text, busy, error, refresh, prepare, resolve };
});
