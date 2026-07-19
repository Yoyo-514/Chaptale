export const RETAIN_RECENT_BLOCKS = 2;

export type FenceMarker = '`' | '~';
export type BlockKind = 'paragraph' | 'table' | 'list' | 'blockquote';

export type FenceInfo = {
  marker: FenceMarker;
  length: number;
};

type ScannerState = {
  inFence: boolean;
  fenceMarker: FenceMarker;
  fenceLength: number;
  blockKind?: BlockKind;
};

export function getFullLineEnd(content: string) {
  const lastNewline = content.lastIndexOf('\n');
  return lastNewline === -1 ? 0 : lastNewline + 1;
}

/**
 * 扫描完整行并返回可以永久提交为 HTML 的偏移量。
 * 最近两个块继续留在 tail，因为表格、列表和围栏代码可能被后续行重新解释；已提交区域则无需再次交给 marked。
 */
export function scanStableOffset(content: string, startOffset: number, endOffset: number) {
  if (endOffset <= startOffset) {
    return startOffset;
  }

  const state: ScannerState = {
    inFence: false,
    fenceMarker: '`',
    fenceLength: 3
  };
  const blockBoundaries: number[] = [];
  let lineStart = startOffset;

  while (lineStart < endOffset) {
    const lineEnd = content.indexOf('\n', lineStart);
    const end = lineEnd === -1 || lineEnd >= endOffset ? endOffset : lineEnd + 1;
    const line = content.slice(lineStart, end);

    scanLine(line, lineStart, end, state, blockBoundaries);
    lineStart = end;
  }

  const retainedBoundaryIndex = blockBoundaries.length - RETAIN_RECENT_BLOCKS - 1;

  if (retainedBoundaryIndex < 0) {
    return startOffset;
  }

  return blockBoundaries[retainedBoundaryIndex] ?? startOffset;
}

export function parseFence(line: string): FenceInfo | undefined {
  const match = line.match(/^\s*(`{3,}|~{3,})/);

  if (!match) {
    return undefined;
  }

  return {
    marker: match[1][0] as FenceMarker,
    length: match[1].length
  };
}

function scanLine(line: string, lineStart: number, lineEnd: number, state: ScannerState, blockBoundaries: number[]) {
  const fence = parseFence(line);

  if (fence) {
    scanFenceLine(fence, lineEnd, state, blockBoundaries);
    return;
  }

  if (state.inFence) {
    return;
  }

  if (line.trim() === '') {
    pushBoundary(blockBoundaries, lineEnd);
    state.blockKind = undefined;
    return;
  }

  const nextBlockKind = getLineBlockKind(line);

  if (state.blockKind && nextBlockKind !== state.blockKind) {
    pushBoundary(blockBoundaries, lineStart);
  }

  state.blockKind = nextBlockKind;
}

// 围栏内部的空行和 Markdown 标记都属于代码，只有匹配 marker 且长度足够的结束围栏才能形成稳定边界。
function scanFenceLine(fence: FenceInfo, lineEnd: number, state: ScannerState, blockBoundaries: number[]) {
  if (!state.inFence) {
    state.inFence = true;
    state.fenceMarker = fence.marker;
    state.fenceLength = fence.length;
    state.blockKind = undefined;
    return;
  }

  if (fence.marker === state.fenceMarker && fence.length >= state.fenceLength) {
    state.inFence = false;
    pushBoundary(blockBoundaries, lineEnd);
  }
}

function pushBoundary(boundaries: number[], offset: number) {
  if (offset > 0 && boundaries.at(-1) !== offset) {
    boundaries.push(offset);
  }
}

function getLineBlockKind(line: string): BlockKind {
  const trimmed = line.trimStart();

  if (/^>\s?/.test(trimmed)) {
    return 'blockquote';
  }

  if (/^([-+*]|\d+[.)])\s+/.test(trimmed)) {
    return 'list';
  }

  if (looksLikeTableLine(trimmed)) {
    return 'table';
  }

  return 'paragraph';
}

function looksLikeTableLine(trimmedLine: string) {
  return trimmedLine.includes('|') && !trimmedLine.startsWith('```') && !trimmedLine.startsWith('~~~');
}
