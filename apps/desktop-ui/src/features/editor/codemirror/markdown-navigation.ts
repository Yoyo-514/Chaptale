import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

export type DocumentHeading = { from: number; to: number; level: number; title: string };

export function documentHeadRange(state: EditorState) {
  if (state.doc.line(1).text !== '---') return null;
  for (let number = 2; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    if (line.from > 64 * 1024) return null;
    if (line.text === '---') return { from: state.doc.line(1).to, to: line.to };
  }
  return null;
}

export function documentHeadings(state: EditorState): DocumentHeading[] {
  const headings: DocumentHeading[] = [];
  const head = documentHeadRange(state);
  (ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state)).iterate({
    enter(node) {
      if (!/^(ATX|Setext)Heading[1-6]$/.test(node.name) || node.from < (head?.to ?? 0)) return;
      const title = state
        .sliceDoc(node.from, node.to)
        .split('\n')[0]!
        .replace(/^#{1,6}\s+|(?:\s+#+)?\s*$/g, '');
      headings.push({ from: node.from, to: node.to, level: Number(node.name.at(-1)), title });
    }
  });
  return headings;
}
