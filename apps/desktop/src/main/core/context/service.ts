import { promises as fs } from 'node:fs';
import { unique } from 'radash';

import type { ChatContextFile } from '@chaptale/shared';

import { getDocumentMimeType, getFileKind, getImageMimeType } from '../../infra/filesystem/file-kind';
import type { ImageBlock } from '../attachments/service';
import type { AttachedFileSearchPort } from './attached-file-search-port';
import { toChatContextFile } from './chat-context-file';
import {
  MAX_CONTEXT_FILE_BYTES,
  MAX_DIRECT_BYTES,
  MAX_DIRECT_TOKENS,
  MAX_DIRECT_TOTAL_BYTES,
  MAX_DOCUMENT_PARSE_BYTES,
  MAX_PROMPT_IMAGE_BYTES,
  MAX_SEARCH_BYTES,
  MAX_SEARCH_TOKENS
} from './constants';
import type { DocumentParserPort } from './document-parser-port';
import {
  buildDocInput,
  buildDocNoText,
  buildDocParseError,
  buildDocTextLimit,
  buildDocTooLarge,
  buildTextInput,
  buildUnsupportedDoc
} from './file-input';
import {
  buildSearchPlaceholder,
  buildSearchResult,
  buildOversizedFileBlock,
  buildOversizedImageBlock,
  buildUnavailableFileBlock
} from './file-search';
import type { ContextFilePlatform } from './platform';
import { estimateTextTokens, isTextWithinTokenLimit } from './token-counter';

export type ContextImage = Omit<ImageBlock, 'blockIndex'>;

export type ResolvedContextFiles = {
  promptPrefix: string;
  images: ContextImage[];
  imagePaths: string[];
};

export type ResolveContextFileOptions = {
  query?: string;
  signal?: AbortSignal;
};

type ResolvedBlock = {
  block: string;
  directBytes: number;
  searchTokens: number;
};

/** 将本地上下文文件归一化为提示词片段与项目内部图片数据，不暴露模型 SDK 类型。 */
export class ContextFileService {
  constructor(
    private readonly platform: ContextFilePlatform,
    private readonly parser: DocumentParserPort,
    private readonly searcher: AttachedFileSearchPort
  ) {}

  async selectFiles(owner?: unknown): Promise<ChatContextFile[]> {
    const selectedPaths = await this.platform.selectContextFilePaths(owner);
    const selected: ChatContextFile[] = [];

    for (const filePath of selectedPaths) {
      const file = await toChatContextFile(filePath, this.platform);
      if (file.kind !== 'unsupported') selected.push(file);
    }

    return selected;
  }

  /** 校验拖拽传入的本地路径，不存在/不支持的文件会被过滤掉。 */
  async inspectFiles(filePaths: string[] = []): Promise<ChatContextFile[]> {
    const inspected: ChatContextFile[] = [];

    for (const filePath of unique(filePaths)) {
      const file = await toChatContextFile(filePath, this.platform).catch(() => undefined);
      if (file && file.kind !== 'unsupported') inspected.push(file);
    }

    return inspected;
  }

  /**
   * 文本在预算内直接注入，超限时经短生命周期本地索引选取相关片段；二进制文档先提取原生文本，
   * 永不执行 OCR；图片保持原生多模态块，避免二进制内容进入文本信封。
   */
  async resolve(filePaths: string[] = [], options: ResolveContextFileOptions = {}): Promise<ResolvedContextFiles> {
    const { signal, query = '' } = options;
    const blocks: string[] = [];
    const images: ContextImage[] = [];
    const imagePaths: string[] = [];
    // 多附件按选择顺序共同消费直接输入和搜索片段预算。
    let directLeft = MAX_DIRECT_TOTAL_BYTES;
    let searchLeft = MAX_SEARCH_TOKENS;

    for (const filePath of unique(filePaths)) {
      signal?.throwIfAborted();
      const kind = getFileKind(filePath);
      if (kind === 'unsupported') continue;

      const stats = await fs.stat(filePath).catch(() => undefined);
      if (!stats?.isFile()) {
        blocks.push(buildUnavailableFileBlock(filePath, kind));
        continue;
      }
      if (kind === 'image' && stats.size > MAX_PROMPT_IMAGE_BYTES) {
        blocks.push(buildOversizedImageBlock(filePath, stats, MAX_PROMPT_IMAGE_BYTES));
        continue;
      }
      if (stats.size > MAX_CONTEXT_FILE_BYTES) {
        blocks.push(buildOversizedFileBlock(filePath, stats));
        continue;
      }

      if (kind === 'text') {
        const result = await this.resolveText(filePath, stats, query, directLeft, searchLeft, signal);
        blocks.push(result.block);
        directLeft -= result.directBytes;
        searchLeft -= result.searchTokens;
        continue;
      }
      if (kind === 'document') {
        const result = await this.resolveDocument(filePath, stats, query, directLeft, searchLeft, signal);
        blocks.push(result.block);
        directLeft -= result.directBytes;
        searchLeft -= result.searchTokens;
        continue;
      }

      const data = await fs.readFile(filePath, 'base64').catch(() => undefined);
      if (data === undefined) {
        blocks.push(buildUnavailableFileBlock(filePath, kind));
        continue;
      }
      images.push({ type: 'image', data, mimeType: getImageMimeType(filePath) });
      imagePaths.push(filePath);
    }

    return {
      promptPrefix: blocks.length
        ? `<attached_context_files>\n${blocks.join('\n\n')}\n</attached_context_files>\n\n`
        : '',
      images,
      imagePaths
    };
  }

  private async resolveText(
    filePath: string,
    stats: { size: number },
    query: string,
    directLeft: number,
    searchLeft: number,
    signal?: AbortSignal
  ): Promise<ResolvedBlock> {
    if (stats.size > MAX_SEARCH_BYTES) {
      return noUsage(buildSearchPlaceholder(filePath, stats));
    }

    const text = await fs.readFile(filePath, 'utf8').catch(() => undefined);
    if (text === undefined) return noUsage(buildUnavailableFileBlock(filePath, 'text'));
    signal?.throwIfAborted();

    const bytes = Buffer.byteLength(text, 'utf8');
    if (fitsDirectInput(text, bytes, directLeft)) {
      return { block: buildTextInput(filePath, stats, text), directBytes: bytes, searchTokens: 0 };
    }

    return (
      (await this.searchText(filePath, stats, text, query, searchLeft, { kind: 'text' }, signal)) ??
      noUsage(buildSearchPlaceholder(filePath, stats))
    );
  }

  private async resolveDocument(
    filePath: string,
    stats: { size: number },
    query: string,
    directLeft: number,
    searchLeft: number,
    signal?: AbortSignal
  ): Promise<ResolvedBlock> {
    const mimeType = getDocumentMimeType(filePath);
    if (!this.parser.supports(filePath)) {
      return noUsage(buildUnsupportedDoc(filePath, stats, mimeType));
    }
    if (stats.size > MAX_DOCUMENT_PARSE_BYTES) {
      return noUsage(buildDocTooLarge(filePath, stats, mimeType, MAX_DOCUMENT_PARSE_BYTES));
    }

    let text: string;
    try {
      text = (await this.parser.parse(filePath, signal)).text.trim();
    } catch {
      signal?.throwIfAborted();
      return noUsage(buildDocParseError(filePath, stats, mimeType));
    }

    signal?.throwIfAborted();
    if (!text) return noUsage(buildDocNoText(filePath, stats, mimeType));

    const bytes = Buffer.byteLength(text, 'utf8');
    if (fitsDirectInput(text, bytes, directLeft)) {
      return {
        block: buildDocInput(filePath, stats, mimeType, text),
        directBytes: bytes,
        searchTokens: 0
      };
    }

    return (
      (await this.searchText(filePath, stats, text, query, searchLeft, { kind: 'document', mimeType }, signal)) ??
      noUsage(buildDocTextLimit(filePath, stats, mimeType))
    );
  }

  private async searchText(
    filePath: string,
    stats: { size: number },
    text: string,
    query: string,
    maxTokens: number,
    meta: { kind: 'text' | 'document'; mimeType?: string },
    signal?: AbortSignal
  ): Promise<ResolvedBlock | undefined> {
    if (maxTokens <= 0) return undefined;

    try {
      const snippets = await this.searcher.search({ sourcePath: filePath, text, query, maxTokens, signal });
      signal?.throwIfAborted();
      if (!snippets.length) return undefined;
      return {
        block: buildSearchResult(filePath, stats, snippets, meta),
        directBytes: 0,
        searchTokens: snippets.reduce((total, snippet) => total + estimateTextTokens(snippet.body), 0)
      };
    } catch {
      signal?.throwIfAborted();
      return undefined;
    }
  }
}

function fitsDirectInput(text: string, bytes: number, bytesLeft: number): boolean {
  return bytes <= MAX_DIRECT_BYTES && bytes <= bytesLeft && isTextWithinTokenLimit(text, MAX_DIRECT_TOKENS);
}

function noUsage(block: string): ResolvedBlock {
  return { block, directBytes: 0, searchTokens: 0 };
}
