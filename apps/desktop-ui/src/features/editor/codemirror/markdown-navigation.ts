import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import { Decoration, EditorView, MatchDecorator, ViewPlugin } from '@codemirror/view';

import type { AssetRecord } from '@chaptale/shared';

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

export function wikiLinks(options: {
  assets: () => Promise<readonly AssetRecord[]>;
  open: (link: string) => void;
}): Extension {
  const matcher = new MatchDecorator({
    regexp: /\[\[([^\]\r\n]+)\]\]/g,
    decoration: match =>
      Decoration.mark({
        class: 'cm-wiki-link',
        attributes: {
          'data-wiki-link': match[0],
          title: '按住 Ctrl 或 Command 点击打开引用',
          role: 'link',
          tabindex: '0'
        }
      })
  });
  const links = ViewPlugin.fromClass(
    class {
      decorations;
      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view);
      }
      update(update: Parameters<typeof matcher.updateDeco>[0]) {
        this.decorations = matcher.updateDeco(update, this.decorations);
      }
    },
    { decorations: plugin => plugin.decorations }
  );
  const complete = async (context: CompletionContext) => {
    const before = context.matchBefore(/\[\[[^\]\r\n]*$/);
    if (!before) return null;
    const assets = await options.assets();
    if (context.aborted) return null;
    return {
      from: before.from + 2,
      options: assets
        .filter(asset => asset.status !== 'archived' && asset.role !== 'templates')
        .map(asset => ({
          label: asset.title,
          detail: asset.sourcePath,
          type: 'text',
          apply:
            asset.sourcePath.replace(/\.md$/i, '') +
            (context.state.sliceDoc(context.pos, context.pos + 2) === ']]' ? '' : ']]')
        })),
      validFor: /^[^\]\r\n]*$/
    };
  };
  return [
    links,
    autocompletion({ override: [complete] }),
    EditorView.domEventHandlers({
      click(event) {
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-wiki-link]');
        if (!target || (!event.ctrlKey && !event.metaKey)) return false;
        event.preventDefault();
        options.open(target.dataset.wikiLink!);
        return true;
      },
      keydown(event) {
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-wiki-link]');
        if (!target || event.key !== 'Enter') return false;
        event.preventDefault();
        options.open(target.dataset.wikiLink!);
        return true;
      }
    }),
    EditorView.baseTheme({
      '.cm-wiki-link': { color: 'var(--primary-solid)', textDecoration: 'underline', textUnderlineOffset: '3px' },
      '.cm-tooltip-autocomplete': {
        backgroundColor: 'var(--surface-muted)',
        color: 'var(--foreground)',
        border: '1px solid var(--border)',
        maxWidth: 'min(480px, 80vw)',
        fontSize: '12px'
      }
    })
  ];
}
