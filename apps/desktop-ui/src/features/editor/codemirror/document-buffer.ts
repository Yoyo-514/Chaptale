import { history, invertedEffects } from '@codemirror/commands';
import { Compartment, EditorState, StateEffect, StateField, type Extension, type Transaction } from '@codemirror/state';

type LineFormat = { bom: boolean; preferred: string; separators: readonly string[] };
const restoreLineFormat = StateEffect.define<LineFormat>();

const lineFormat = StateField.define<LineFormat>({
  create: () => ({ bom: false, preferred: '\n', separators: [] }),
  update(value, transaction) {
    // 合并的撤销按「较新到较旧」排列效果，最后一个才是整组之前的格式。
    const restored = transaction.effects.findLast(effect => effect.is(restoreLineFormat));
    if (restored) return restored.value;
    if (!transaction.docChanged) return value;
    let separators: string[] | undefined;
    let offset = 0;
    transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      const first = transaction.startState.doc.lineAt(from).number - 1;
      const removed = transaction.startState.doc.lineAt(to).number - first - 1;
      const added = inserted.lines - 1;
      if (!removed && !added) return;
      separators ??= [...value.separators];
      const replacement = Array.from({ length: added }, (_, index) =>
        index < removed ? value.separators[first + index] : value.preferred
      );
      const index = first + offset;
      separators = separators.slice(0, index).concat(replacement, separators.slice(index + removed));
      offset += added - removed;
    });
    return separators ? { ...value, separators } : value;
  }
});

function parseLineFormat(content: string): LineFormat {
  const separators = [...content.matchAll(/\r\n?|\n/g)].map(match => match[0]);
  const counts = new Map<string, number>();
  let preferred = '\n';
  let maximum = 0;
  for (const separator of separators) {
    const count = (counts.get(separator) ?? 0) + 1;
    counts.set(separator, count);
    if (count > maximum) {
      maximum = count;
      preferred = separator;
    }
  }
  return { bom: content.startsWith('\uFEFF'), preferred, separators };
}

export function serializeDocument(state: EditorState): string {
  const format = state.field(lineFormat);
  const parts: string[] = [format.bom ? '\uFEFF' : ''];
  for (let line = 1; line <= state.doc.lines; line += 1) {
    parts.push(state.doc.line(line).text);
    if (line < state.doc.lines) parts.push(format.separators[line - 1] ?? format.preferred);
  }
  return parts.join('');
}

/** 每个标签独立持有状态与保存基线；视图卸载和保存成功都不清除撤销历史。 */
export class DocumentBuffer {
  state: EditorState;
  private baseline: EditorState;
  private readonly viewConfig = new Compartment();
  private dispatchToView?: (transaction: Transaction) => void;

  constructor(content: string, extensions: Extension = []) {
    const format = parseLineFormat(content);
    this.state = EditorState.create({
      doc: format.bom ? content.slice(1) : content,
      extensions: [
        lineFormat.init(() => format),
        history(),
        invertedEffects.of(transaction =>
          transaction.docChanged ? [restoreLineFormat.of(transaction.startState.field(lineFormat))] : []
        ),
        this.viewConfig.of(extensions)
      ]
    });
    this.baseline = this.state;
  }

  update(state: EditorState) {
    this.state = state;
  }

  configure(extensions: Extension) {
    this.state = this.state.update({ effects: this.viewConfig.reconfigure(extensions) }).state;
  }

  attach(dispatch: (transaction: Transaction) => void) {
    this.dispatchToView = dispatch;
    return () => {
      if (this.dispatchToView === dispatch) this.dispatchToView = undefined;
    };
  }

  replaceContent(content: string) {
    const format = parseLineFormat(content);
    const transaction = this.state.update({
      changes: { from: 0, to: this.state.doc.length, insert: format.bom ? content.slice(1) : content },
      effects: restoreLineFormat.of(format),
      userEvent: 'input'
    });
    if (this.dispatchToView) this.dispatchToView(transaction);
    else this.update(transaction.state);
  }

  markSaved(sentState: EditorState) {
    this.baseline = sentState;
  }

  get dirty() {
    if (!this.state.doc.eq(this.baseline.doc)) return true;
    const current = this.state.field(lineFormat);
    const saved = this.baseline.field(lineFormat);
    return (
      current.bom !== saved.bom ||
      current.separators.length !== saved.separators.length ||
      current.separators.some((separator, index) => separator !== saved.separators[index])
    );
  }

  get content() {
    return serializeDocument(this.state);
  }
}
