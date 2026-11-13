import type { EditorState } from '@codemirror/state';

import type { EditorContext } from '@chaptale/agent-host/protocol';

import { useCreationStore, useTrashStore } from '@/features/creation';

import { useCheckStore } from './check/store';
import { useHistoryStore } from './history/store';
import { useReadingStore } from './reading/store';
import { serializeLike } from './review/chunk-range';
import { useReviewStore } from './review/store';
import { useEditorStore } from './store';

/** CodeMirror 的换行已规范化，按行映射回实际稿件，保留选区的换行与字符。 */
export function selectedText(state: EditorState, content: string): string | undefined {
  const selection = state.selection.main;
  if (selection.empty) return undefined;
  const starts = [content.startsWith('\uFEFF') && state.doc.sliceString(0, 1) !== '\uFEFF' ? 1 : 0];
  for (const match of content.matchAll(/\r\n?|\n/g)) starts.push(match.index + match[0].length);
  const offset = (position: number) => {
    const line = state.doc.lineAt(position);
    return starts[line.number - 1] + position - line.from;
  };
  return content.slice(offset(selection.from), offset(selection.to));
}

export interface PreparedEditorContext {
  ok: boolean;
  context?: EditorContext;
}

/** 仅感知当前聚焦的正式文稿、资料、阅读页或本会话审阅标签；存在未保存手改时先弹窗询问保存。 */
export function useEditorContext() {
  const creation = useCreationStore();
  const editor = useEditorStore();
  const review = useReviewStore();
  const history = useHistoryStore();
  const check = useCheckStore();
  const trash = useTrashStore();
  const reading = useReadingStore();

  async function prepare(sessionId: string | null): Promise<PreparedEditorContext> {
    if (creation.libraryOpen || trash.preview?.document || check.activeTab || history.activeTab) return { ok: true };

    const reviewing = review.activeTab;
    if (reviewing) {
      if (reviewing.sessionId !== sessionId) return { ok: true };
      const initialCandidate = reviewing.review?.candidate;
      const initialState = review.getState(reviewing.key);
      const selection =
        initialState && initialCandidate?.kind === 'document' && initialCandidate.content !== null
          ? selectedText(
              initialState,
              reviewing.dirty ? serializeLike(initialState.doc, initialCandidate.content) : initialCandidate.content
            )
          : undefined;
      if (reviewing.dirty) {
        const choice = await editor.promptUnsaved([reviewing.title], false);
        if (choice !== 'save' || !(await review.save(reviewing.key))) return { ok: false };
      }
      const latest = review.tabs.find(item => item.key === reviewing.key) ?? reviewing;
      return {
        ok: true,
        context: {
          workId: latest.workId,
          entryId: latest.entryId,
          title: latest.title,
          section: latest.section,
          ...(selection && { selection })
        }
      };
    }

    const tab = editor.activeTab;
    if (!tab) return { ok: true };

    const position = reading.positions[tab.id];
    if (position) {
      const opened = editor.tabs.find(item => item.id === position.documentId);
      if (opened?.dirty) {
        const choice = await editor.promptUnsaved([opened.title], false);
        if (choice !== 'save' || !(await editor.saveDocument(opened.id))) return { ok: false };
      }
      const entry = creation.entries.find(item => item.id === position.documentId);
      const selection = reading.selectedText(tab.id) || undefined;
      return {
        ok: true,
        context: {
          workId: tab.workId,
          entryId: position.documentId,
          title: opened?.title ?? entry?.title ?? tab.title,
          section: entry?.section ?? tab.document?.section ?? 'manuscript',
          ...(selection && { selection })
        }
      };
    }

    if (tab.dirty) {
      const choice = await editor.promptUnsaved([tab.title], false);
      if (choice !== 'save' || !(await editor.saveDocument(tab.id))) return { ok: false };
    }
    const latest = editor.tabs.find(item => item.id === tab.id) ?? tab;
    const buffer = latest.status === 'ready' ? editor.getBuffer(latest.id) : undefined;
    const selection = buffer ? selectedText(buffer.state, buffer.content) : undefined;
    return {
      ok: true,
      context: {
        workId: latest.workId,
        entryId: latest.id,
        title: latest.title,
        section:
          latest.document?.section ?? creation.entries.find(entry => entry.id === latest.id)?.section ?? 'manuscript',
        ...(selection && { selection })
      }
    };
  }

  async function prepareQuoted(sessionId: string | null, quoted: EditorContext): Promise<PreparedEditorContext> {
    const reviewing = sessionId
      ? review.tabs.find(item => item.sessionId === sessionId && item.entryId === quoted.entryId)
      : undefined;
    if (reviewing?.dirty) {
      const choice = await editor.promptUnsaved([reviewing.title], false);
      if (choice !== 'save' || !(await review.save(reviewing.key))) return { ok: false };
    }
    const opened = editor.tabs.find(item => item.id === quoted.entryId);
    if (opened?.dirty) {
      const choice = await editor.promptUnsaved([opened.title], false);
      if (choice !== 'save' || !(await editor.saveDocument(opened.id))) return { ok: false };
    }
    const latestDoc = editor.tabs.find(item => item.id === quoted.entryId);
    const latestEntry = creation.entries.find(item => item.id === quoted.entryId);
    return {
      ok: true,
      context: {
        ...quoted,
        title: latestDoc?.title ?? latestEntry?.title ?? quoted.title
      }
    };
  }

  return {
    prepare: async (sessionId: string | null, quoted?: EditorContext): Promise<PreparedEditorContext> => {
      const result = quoted ? await prepareQuoted(sessionId, quoted) : await prepare(sessionId);
      return {
        ok: result.ok,
        context: result.context && (JSON.parse(JSON.stringify(result.context)) as EditorContext)
      };
    }
  };
}
