import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { MAX_SEARCH_BYTES, MAX_SEARCH_TOKENS } from '../../../../core/context/constants';
import type { DocumentParserPort } from '../../../../core/context/document-parser-port';
import type { ContextFilePlatform } from '../../../../core/context/platform';
import { ContextFileService } from '../../../../core/context/service';
import { estimateTextTokens } from '../../../../core/context/token-counter';
import { AttachedFileSearchService } from '../../../../features/search/attached-file-search-service';
import { InputAssembler } from '../input-assembler';

const platform: ContextFilePlatform = {
  selectContextFilePaths: async () => [],
  createImagePreview: async () => undefined
};
const parser: DocumentParserPort = {
  supports: () => false,
  parse: async () => ({ text: '', warnings: [] })
};
const images = {
  createPresentation: vi.fn(() => ({ attachments: [] }))
};

describe('File Search integration', () => {
  it('injects a relevant tail excerpt from an exact 50 MiB file into the agent prompt', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-file-search-'));
    const filePath = path.join(dir, 'large-reference.txt');
    const marker = '\nThe silver moon key is stored in the north tower on level three.\n';
    const query = 'Where is the silver moon key stored?';
    const fillerBytes = MAX_SEARCH_BYTES - Buffer.byteLength(marker, 'utf8');
    const text = `${'x'.repeat(fillerBytes)}${marker}`;

    try {
      expect(Buffer.byteLength(text, 'utf8')).toBe(MAX_SEARCH_BYTES);
      await writeFile(filePath, text, 'utf8');

      const contextFiles = new ContextFileService(platform, parser, new AttachedFileSearchService());
      const assembler = new InputAssembler({ contextFileService: contextFiles, imageAttachmentService: images });
      const result = await assembler.assemble({
        options: {
          sessionId: 'file-search-integration',
          query,
          signal: new AbortController().signal,
          contextFilePaths: [filePath]
        }
      });

      expect(result.promptText).toContain('handling="file-search-results"');
      expect(result.promptText).toContain('silver moon key is stored in the north tower');
      expect(result.promptText.endsWith(query)).toBe(true);
      expect(result.userMessage.role).toBe('user');
      if (result.userMessage.role !== 'user') throw new TypeError('Expected a user message');
      expect(result.userMessage.contextFiles).toHaveLength(1);

      const excerpts = [...result.promptText.matchAll(/<excerpt\b[^>]*>([\s\S]*?)<\/excerpt>/gu)].map(
        match => match[1] ?? ''
      );
      expect(excerpts.length).toBeGreaterThan(0);
      expect(excerpts.reduce((total, excerpt) => total + estimateTextTokens(excerpt), 0)).toBeLessThanOrEqual(
        MAX_SEARCH_TOKENS
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
