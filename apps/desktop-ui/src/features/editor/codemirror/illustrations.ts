import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

import { formatIllustration, parseIllustration, type Illustration } from '@chaptale/creation/text';

/** 插图图片的读取结果；src 为 Object URL，由调用方持有和释放。 */
export type IllustrationImage = { src: string; width: number; height: number } | { error: string };

export interface IllustrationOptions {
  /** Markdown 文稿显示缩略图；TXT 文稿只接收拖放与粘贴，由调用方提示转换格式。 */
  render: boolean;
  /** 同一图片条目多次调用应复用同一个结果。 */
  load: (entryId: string) => Promise<IllustrationImage>;
  /** 已读取完成的结果；有结果时同步建出固定尺寸的部件，编辑器首次测量即得到正确高度。 */
  peek: (entryId: string) => IllustrationImage | undefined;
  /** 拖入或粘贴图片；after 为插入位置所在行的行尾偏移。 */
  drop: (event: DragEvent | ClipboardEvent, after: number) => boolean;
  /** 双击缩略图放大。 */
  preview: (entryId: string) => void;
}

class IllustrationWidget extends WidgetType {
  private readonly illustration: Illustration;
  private readonly options: IllustrationOptions;
  private readonly generation: number;
  constructor(illustration: Illustration, options: IllustrationOptions, generation: number) {
    super();
    this.illustration = illustration;
    this.options = options;
    this.generation = generation;
  }
  override eq(other: IllustrationWidget) {
    return (
      other.illustration.entryId === this.illustration.entryId &&
      other.illustration.caption === this.illustration.caption &&
      other.generation === this.generation
    );
  }
  override toDOM(view: EditorView) {
    const figure = document.createElement('figure');
    figure.className = 'cm-illustration';
    figure.setAttribute('aria-label', `插图 ${this.illustration.caption}`);
    const frame = figure.appendChild(document.createElement('div'));
    frame.className = 'cm-illustration-frame';
    const image = this.options.peek(this.illustration.entryId);
    if (image) {
      this.render(frame, image);
      return figure;
    }
    // 短文稿的内容区高度固定，编辑器察觉不到部件变高，行号与当前行高亮会错位；
    // 读取完成后重建插图部件，由编辑器重新测量。
    void this.options.load(this.illustration.entryId).then(() => {
      if (figure.isConnected) reloadIllustrations(view);
    });
    return figure;
  }
  private render(frame: HTMLElement, image: IllustrationImage) {
    if ('src' in image) {
      const img = frame.appendChild(document.createElement('img'));
      // 写入原始尺寸，图片解码前就按比例占好位置。
      img.width = image.width;
      img.height = image.height;
      img.src = image.src;
      img.alt = this.illustration.caption;
      img.addEventListener('click', () => this.options.preview(this.illustration.entryId));
      // 说明只在悬停时叠在图片底部。
      if (this.illustration.caption) {
        const caption = frame.appendChild(document.createElement('span'));
        caption.className = 'cm-illustration-caption';
        caption.textContent = this.illustration.caption;
      }
    } else {
      frame.textContent = this.illustration.caption ? `${image.error}：${this.illustration.caption}` : image.error;
      frame.classList.add('is-missing');
    }
  }
  /** 点击图片打开预览，不移动光标；点击图片以外的区域仍由编辑器处理。 */
  override ignoreEvent(event: Event) {
    return event.target instanceof HTMLImageElement;
  }
}

/** 光标不在插图行时，把整行替换为缩略图与说明；光标进入时显示原文。 */
function illustrationDecorations(state: EditorState, options: IllustrationOptions, generation: number): DecorationSet {
  if (!options.render) return Decoration.none;
  const ranges = [];
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    const illustration = parseIllustration(line.text);
    if (!illustration) continue;
    if (state.selection.ranges.some(range => range.from <= line.to && range.to >= line.from)) continue;
    ranges.push(
      Decoration.replace({ widget: new IllustrationWidget(illustration, options, generation), block: true }).range(
        line.from,
        line.to
      )
    );
  }
  return Decoration.set(ranges);
}

const reload = StateEffect.define<null>();
/** 图片条目进出回收站后重新读取全部插图。 */
export function reloadIllustrations(view: EditorView) {
  view.dispatch({ effects: reload.of(null) });
}

const setDropLine = StateEffect.define<number | null>();
/** 拖放插入线：画在放下后插图所在行之前（即目标段落下沿）。 */
const dropLine = StateField.define<number | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setDropLine)) value = effect.value;
    return value;
  },
  provide: field =>
    EditorView.decorations.from(field, line =>
      line === null ? Decoration.none : Decoration.set([Decoration.line({ class: 'cm-drop-after' }).range(line)])
    )
});

function lineEndAt(view: EditorView, event: DragEvent) {
  const position = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
  return view.state.doc.lineAt(position).to;
}
function acceptsDrop(event: DragEvent) {
  const types = event.dataTransfer?.types ?? [];
  return types.includes('Files') || types.includes('application/chaptale-entry');
}

export function illustrations(options: IllustrationOptions): Extension {
  let generation = 0;
  const decorations = StateField.define<DecorationSet>({
    create: state => illustrationDecorations(state, options, generation),
    update(value, transaction) {
      if (transaction.effects.some(effect => effect.is(reload))) generation += 1;
      else if (!transaction.docChanged && !transaction.selection) return value.map(transaction.changes);
      return illustrationDecorations(transaction.state, options, generation);
    },
    provide: field => EditorView.decorations.from(field)
  });
  return [
    decorations,
    dropLine,
    EditorView.domEventHandlers({
      dragover(event, view) {
        if (!acceptsDrop(event)) return false;
        event.preventDefault();
        event.dataTransfer!.dropEffect = 'copy';
        const line = view.state.doc.lineAt(lineEndAt(view, event)).from;
        if (view.state.field(dropLine) !== line) view.dispatch({ effects: setDropLine.of(line) });
        return true;
      },
      dragleave(event, view) {
        if (!view.dom.contains(event.relatedTarget as Node | null)) view.dispatch({ effects: setDropLine.of(null) });
        return false;
      },
      drop(event, view) {
        if (!acceptsDrop(event)) return false;
        // 阻止浏览器把文件当作导航或文本插入。
        event.preventDefault();
        view.dispatch({ effects: setDropLine.of(null) });
        return options.drop(event, lineEndAt(view, event));
      },
      paste(event, view) {
        if (![...(event.clipboardData?.files ?? [])].some(file => file.type.startsWith('image/'))) return false;
        event.preventDefault();
        return options.drop(event, view.state.doc.lineAt(view.state.selection.main.head).to);
      }
    })
  ];
}

/**
 * 在 after 所在行之后插入独占一行的插图，光标移到下一行开头，插图随即显示为缩略图；
 * 插图在文末时补一个空行承接光标。返回插图行尾，供连续插入。
 */
export function insertIllustration(view: EditorView, after: number, illustration: Illustration): number {
  const doc = view.state.doc;
  const line = doc.lineAt(Math.min(after, doc.length));
  const text = `${doc.length === 0 ? '' : '\n'}${formatIllustration(illustration)}`;
  const end = line.to + text.length;
  view.dispatch({
    changes: { from: line.to, insert: line.number === doc.lines ? `${text}\n` : text },
    selection: { anchor: end + 1 },
    scrollIntoView: true,
    userEvent: 'input.illustration'
  });
  return end;
}
