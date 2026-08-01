import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../constants', async importOriginal => ({
  ...(await importOriginal<typeof import('../constants')>()),
  MAX_DIRECT_BYTES: 10,
  MAX_DIRECT_TOTAL_BYTES: 10
}));

import type { AttachedFileSearchPort } from '../attached-file-search-port';
import type { DocumentParserPort } from '../document-parser-port';
import type { ContextFilePlatform } from '../platform';
import { ContextFileService as ProductionContextFileService } from '../service';

const platform: ContextFilePlatform = {
  selectContextFilePaths: async () => [],
  createImagePreview: async () => undefined
};

const documentParser: DocumentParserPort = {
  supports: () => false,
  parse: async () => ({ text: '', warnings: [] })
};
const fileSearch: AttachedFileSearchPort = {
  search: async () => []
};

class ContextFileService extends ProductionContextFileService {
  constructor(
    contextFilePlatform: ContextFilePlatform,
    parser: DocumentParserPort = documentParser,
    search: AttachedFileSearchPort = fileSearch
  ) {
    super(contextFilePlatform, parser, search);
  }
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(tempDir => rm(tempDir, { recursive: true, force: true })));
});

describe('ContextFileService direct text budget', () => {
  it('accepts the exact per-file boundary and rejects one byte over it', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-context-budget-'));
    tempDirs.push(tempDir);
    const boundaryPath = path.join(tempDir, 'boundary.txt');
    const oversizedPath = path.join(tempDir, 'oversized.txt');
    await writeFile(boundaryPath, '1234567890', 'utf8');
    await writeFile(oversizedPath, '12345678901', 'utf8');

    const boundaryResult = await new ContextFileService(platform).resolve([boundaryPath]);
    const oversizedResult = await new ContextFileService(platform).resolve([oversizedPath]);

    expect(boundaryResult.promptPrefix).toContain('handling="file-input-text"');
    expect(oversizedResult.promptPrefix).toContain('handling="file-search-placeholder"');
  });

  it('injects local search snippets when oversized text has relevant matches', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-context-budget-'));
    tempDirs.push(tempDir);
    const filePath = path.join(tempDir, 'searchable.txt');
    await writeFile(filePath, '12345678901', 'utf8');
    const search: AttachedFileSearchPort = {
      search: vi.fn(async () => [{ headingPath: ['命中'], body: '相关片段', startOffset: 2, endOffset: 6 }])
    };

    const result = await new ContextFileService(platform, documentParser, search).resolve([filePath], {
      query: '查找相关内容'
    });

    expect(result.promptPrefix).toContain('handling="file-search-results"');
    expect(result.promptPrefix).toContain('heading="命中"');
    expect(result.promptPrefix).toContain('相关片段');
    expect(search.search).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePath: filePath, text: '12345678901', query: '查找相关内容', maxTokens: 8_000 })
    );
  });

  it('searches extracted document text instead of asking the model to read binary files', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-context-budget-'));
    tempDirs.push(tempDir);
    const filePath = path.join(tempDir, 'searchable.pdf');
    await writeFile(filePath, 'binary', 'utf8');
    const parser: DocumentParserPort = {
      supports: () => true,
      parse: vi.fn(async () => ({ text: '12345678901', warnings: [] }))
    };
    const search: AttachedFileSearchPort = {
      search: vi.fn(async () => [{ headingPath: [], body: '文档命中片段', startOffset: 0, endOffset: 6 }])
    };

    const result = await new ContextFileService(platform, parser, search).resolve([filePath], { query: '文档问题' });

    expect(result.promptPrefix).toContain('handling="file-search-results"');
    expect(result.promptPrefix).toContain('kind="document"');
    expect(result.promptPrefix).toContain('文档命中片段');
    expect(result.promptPrefix).not.toContain('read/grep/find/ls');
  });

  it('uses the remaining per-message budget across multiple text files', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-context-budget-'));
    tempDirs.push(tempDir);
    const firstPath = path.join(tempDir, 'first.txt');
    const secondPath = path.join(tempDir, 'second.txt');
    await writeFile(firstPath, '123456', 'utf8');
    await writeFile(secondPath, 'abcde', 'utf8');

    const result = await new ContextFileService(platform).resolve([firstPath, secondPath]);

    expect(result.promptPrefix).toContain('123456');
    expect(result.promptPrefix).toContain(`path="${secondPath}" handling="file-search-placeholder"`);
    expect(result.promptPrefix).not.toContain('abcde');
  });
});
