import { history, invertedEffects, isolateHistory, redo, undo } from '@codemirror/commands';
import { diff } from '@codemirror/merge';
import {
  Annotation,
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
  type TransactionSpec
} from '@codemirror/state';

type LineFormat = { bom: boolean; preferred: string; separators: readonly string[] };
const restoreLineFormat = StateEffect.define<LineFormat>();
export const controlledEdit = Annotation.define<boolean>();
export const peerSync = Annotation.define<boolean>();

export interface BufferPeer {
  syncDoc(spec: TransactionSpec): void;
  syncLock(locked: boolean): void;
  notifyChange?(): void;
}

export function lockExtensions(locked: boolean): Extension {
  return locked
    ? [
        EditorState.readOnly.of(true),
        EditorState.transactionFilter.of(change =>
          change.docChanged && !change.annotation(controlledEdit) ? [] : change
        )
      ]
    : [];
}

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

function serializeDocument(state: EditorState): string {
  const format = state.field(lineFormat);
  const parts: string[] = [format.bom ? '\uFEFF' : ''];
  for (let line = 1; line <= state.doc.lines; line += 1) {
    parts.push(state.doc.line(line).text);
    if (line < state.doc.lines) parts.push(format.separators[line - 1] ?? format.preferred);
  }
  return parts.join('');
}

/** 每份文档共享唯一正文状态、原始换行与撤销历史；双编辑组挂载多个视图时实时同步正文并保留各自光标。 */
export class DocumentBuffer {
  state: EditorState;
  private baseline: EditorState;
  private lockedState = false;
  private readonly viewConfig = new Compartment();
  private readonly lockConfig = new Compartment();
  private readonly peers = new Set<BufferPeer>();

  constructor(content: string, extensions: Extension = []) {
    const format = parseLineFormat(content);
    this.state = EditorState.create({
      doc: format.bom ? content.slice(1) : content,
      extensions: [
        lineFormat.init(() => format),
        history(),
        this.lockConfig.of([]),
        invertedEffects.of(transaction =>
          transaction.docChanged || transaction.effects.some(effect => effect.is(restoreLineFormat))
            ? [restoreLineFormat.of(transaction.startState.field(lineFormat))]
            : []
        ),
        this.viewConfig.of(extensions)
      ]
    });
    this.baseline = this.state;
  }

  get isLocked() {
    return this.lockedState;
  }

  update(state: EditorState) {
    this.state = state;
  }

  configure(extensions: Extension) {
    this.state = this.state.update({ effects: this.viewConfig.reconfigure(extensions) }).state;
  }

  attachPeer(peer: BufferPeer) {
    this.peers.add(peer);
    return () => {
      this.peers.delete(peer);
    };
  }

  /** 将任一挂载视图产生的正文变更写入权威缓冲，并广播给其他分栏视图。 */
  applyViewTransaction(transaction: Transaction, source: BufferPeer) {
    if (transaction.annotation(peerSync) || !transaction.docChanged) return;
    const annotations: Annotation<unknown>[] = [];
    if (transaction.annotation(controlledEdit)) annotations.push(controlledEdit.of(true));
    const isolated = transaction.annotation(isolateHistory);
    if (isolated) annotations.push(isolateHistory.of(isolated));
    const event = transaction.annotation(Transaction.userEvent);
    if (event) annotations.push(Transaction.userEvent.of(event));
    const time = transaction.annotation(Transaction.time);
    if (time !== undefined) annotations.push(Transaction.time.of(time));
    const formatEffects = transaction.effects.filter(effect => effect.is(restoreLineFormat));
    this.state = this.state.update({
      changes: transaction.changes,
      effects: formatEffects,
      annotations
    }).state;
    for (const peer of this.peers) {
      if (peer !== source) {
        peer.syncDoc({
          changes: transaction.changes,
          annotations: [peerSync.of(true), controlledEdit.of(true)]
        });
      }
    }
  }

  private runHistoryCommand(
    command: typeof undo,
    source?: BufferPeer,
    dispatchSource?: (spec: TransactionSpec) => void
  ): boolean {
    return command({
      state: this.state,
      dispatch: transaction => {
        this.state = transaction.state;
        dispatchSource?.({
          changes: transaction.changes,
          selection: { anchor: transaction.state.selection.main.anchor, head: transaction.state.selection.main.head },
          scrollIntoView: true,
          annotations: [peerSync.of(true), controlledEdit.of(true)]
        });
        for (const peer of this.peers) {
          if (peer !== source) {
            peer.syncDoc({
              changes: transaction.changes,
              annotations: [peerSync.of(true), controlledEdit.of(true)]
            });
          }
        }
        source?.notifyChange?.();
      }
    });
  }

  undoFromView(source?: BufferPeer, dispatchSource?: (spec: TransactionSpec) => void): boolean {
    return this.runHistoryCommand(undo, source, dispatchSource);
  }

  redoFromView(source?: BufferPeer, dispatchSource?: (spec: TransactionSpec) => void): boolean {
    return this.runHistoryCommand(redo, source, dispatchSource);
  }

  setLocked(locked: boolean) {
    this.lockedState = locked;
    this.state = this.state.update({ effects: this.lockConfig.reconfigure(lockExtensions(locked)) }).state;
    for (const peer of this.peers) peer.syncLock(locked);
  }

  replaceContent(content: string, isolated = false) {
    const format = parseLineFormat(content);
    const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const transaction = this.state.update({
      changes: diff(this.state.doc.toString(), normalized).map(change => ({
        from: change.fromA,
        to: change.toA,
        insert: normalized.slice(change.fromB, change.toB)
      })),
      effects: restoreLineFormat.of(format),
      annotations: [controlledEdit.of(true), ...(isolated ? [isolateHistory.of('full')] : [])],
      userEvent: 'input'
    });
    this.state = transaction.state;
    for (const peer of this.peers) {
      peer.syncDoc({
        changes: transaction.changes,
        annotations: [peerSync.of(true), controlledEdit.of(true)]
      });
    }
  }

  /** 保存请求发出前划分撤销记录，后续输入可单独撤销回这份快照。 */
  prepareSave(): EditorState {
    this.state = this.state.update({ annotations: isolateHistory.of('full') }).state;
    return this.state;
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
