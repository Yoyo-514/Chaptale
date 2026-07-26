import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../constants', async importOriginal => ({
  ...(await importOriginal<typeof import('../constants')>()),
  MAX_DIRECT_FILE_INPUT_BYTES: 10,
  MAX_DIRECT_FILE_INPUT_TOTAL_BYTES: 10
}));

import type { ContextFilePlatform } from '../platform';
import { ContextFileService } from '../service';

const platform: ContextFilePlatform = {
  selectContextFilePaths: async () => [],
  createImagePreview: async () => undefined
};

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
