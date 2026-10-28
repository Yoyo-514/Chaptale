/** 多栏分页几何：一栏即一页，正文块以 data-offset 标注原文起点。 */
export interface PageGeometry {
  /** 承载正文块的多栏容器。 */
  columns: HTMLElement;
  /** 翻页步长：栏宽加栏间距。 */
  stride: number;
  /** TXT 块内按字符定位；Markdown 只定位到块开头。 */
  charLevel: boolean;
}

export function countPages({ columns, stride }: PageGeometry, gap: number) {
  return Math.max(1, Math.round((columns.scrollWidth + gap) / stride));
}

function blocks(columns: HTMLElement) {
  return [...columns.querySelectorAll<HTMLElement>('[data-offset]')];
}
function columnOf({ columns, stride }: PageGeometry, rect: DOMRect) {
  return Math.floor((rect.left - columns.getBoundingClientRect().left + 1) / stride);
}
function charRect(text: Text, index: number) {
  const range = document.createRange();
  range.setStart(text, index);
  range.setEnd(text, index + 1);
  return range.getClientRects()[0];
}

/** 原文偏移所在的页码。 */
export function pageOf(geometry: PageGeometry, offset: number, pages: number) {
  const all = blocks(geometry.columns);
  const block = all.findLast(item => Number(item.dataset.offset) <= offset) ?? all[0];
  if (!block) return 0;
  const text = block.firstChild;
  const local = offset - Number(block.dataset.offset);
  const rect =
    (geometry.charLevel && text instanceof Text && local > 0 && local < text.length && charRect(text, local)) ||
    block.getClientRects()[0];
  return rect ? Math.min(columnOf(geometry, rect), pages - 1) : 0;
}

/** 页面第一个字符（Markdown 为第一个块）的原文偏移。 */
export function offsetOf(geometry: PageGeometry, page: number) {
  const all = blocks(geometry.columns);
  for (const block of all) {
    const rects = [...block.getClientRects()];
    if (!rects.some(rect => columnOf(geometry, rect) >= page)) continue;
    const start = Number(block.dataset.offset);
    const text = block.firstChild;
    if (!geometry.charLevel || columnOf(geometry, rects[0]!) >= page || !(text instanceof Text)) return start;
    // 段落从上一页延续过来时，二分找到本页第一个字符。
    let low = 0;
    let high = text.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      const rect = charRect(text, middle);
      if (rect && columnOf(geometry, rect) >= page) high = middle;
      else low = middle + 1;
    }
    return start + low;
  }
  return Number(all.at(-1)?.dataset.offset ?? 0);
}
