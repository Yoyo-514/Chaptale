import { mkdir, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextFilePlatform } from '../platform';
import { ContextFileService } from '../service';

function createFakePlatform(overrides: Partial<ContextFilePlatform> = {}) {
  return {
    selectContextFilePaths: vi.fn(async () => []),
    createImagePreview: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,dGh1bWI=', width: 1920, height: 1080 })),
    ...overrides
  } satisfies ContextFilePlatform;
}

describe('ContextFileService', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-context-file-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('uses basic text file input for text files', async () => {
    const filePath = path.join(tempDir, 'note.txt');
    await writeFile(filePath, '第一章 开始\n正文内容', 'utf8');

    const result = await new ContextFileService(createFakePlatform()).resolve([filePath]);

    expect(result.promptPrefix).toContain('<attached_context_files>');
    expect(result.promptPrefix).toContain('handling="file-input-text"');
    expect(result.promptPrefix).toContain('用户随消息提供的文件内容');
    expect(result.promptPrefix).toContain('第一章 开始');
    expect(result.promptPrefix).toContain('正文内容');
    expect(result.promptPrefix).not.toContain('long-text-context-pack');
  });

  it('uses basic text file input for large novels within direct input budget', async () => {
    const filePath = path.join(tempDir, 'novel.txt');
    const chapters = Array.from({ length: 12 }, (_, index) => {
      const chapterNumber = index + 1;
      return `第${chapterNumber}章 标题${chapterNumber}\n${'这是一段小说正文。'.repeat(9000)}`;
    });
    await writeFile(filePath, chapters.join('\n\n'), 'utf8');

    const result = await new ContextFileService(createFakePlatform()).resolve([filePath]);

    expect(result.promptPrefix).toContain('handling="file-input-text"');
    expect(result.promptPrefix).toContain('用户随消息提供的文件内容');
    expect(result.promptPrefix).not.toContain('File Search/RAG');
    expect(result.promptPrefix).toContain('第1章 标题1');
    expect(result.promptPrefix).toContain('第12章 标题12');
    expect(result.promptPrefix).toContain('这是一段小说正文。');
    expect(result.promptPrefix).not.toContain('已跳过全文注入');
  });

  it('does not cap the number of selected context files in main-side inspection', async () => {
    const filePaths = await Promise.all(
      Array.from({ length: 12 }, async (_, index) => {
        const filePath = path.join(tempDir, `note-${index}.txt`);
        await writeFile(filePath, `内容 ${index}`, 'utf8');
        return filePath;
      })
    );

    const inspected = await new ContextFileService(createFakePlatform()).inspectFiles(filePaths);

    expect(inspected).toHaveLength(12);
  });

  it.each([
    ['paper.pdf', 'application/pdf'],
    ['draft.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
  ])('treats %s as metadata-only document input', async (fileName, mimeType) => {
    const filePath = path.join(tempDir, fileName);
    await writeFile(filePath, Buffer.from('mock document body'));

    const [inspected] = await new ContextFileService(createFakePlatform()).inspectFiles([filePath]);
    const result = await new ContextFileService(createFakePlatform()).resolve([filePath]);

    expect(inspected).toMatchObject({ kind: 'document', mimeType });
    expect(result.promptPrefix).toContain('handling="document-file-input"');
    expect(result.promptPrefix).toContain(mimeType);
    expect(result.promptPrefix).toContain('当前消息包含文件元数据与本地路径');
    expect(result.promptPrefix).not.toContain('<content');
    expect(result.promptPrefix).not.toContain('mock document body');
  });

  it('sends supported images as native pi image blocks without a file envelope', async () => {
    const filePath = path.join(tempDir, 'cover.png');
    await writeFile(filePath, Buffer.from('image-data'));

    const result = await new ContextFileService(createFakePlatform()).resolve([filePath]);

    expect(result.images).toEqual([{ type: 'image', data: 'aW1hZ2UtZGF0YQ==', mimeType: 'image/png' }]);
    expect(result.imagePaths).toEqual([filePath]);
    expect(result.promptPrefix).toBe('');
  });

  it('does not cap the number or cumulative size of individually valid images', async () => {
    const filePaths = await Promise.all(
      Array.from({ length: 21 }, async (_, index) => {
        const filePath = path.join(tempDir, `image-${index}.png`);
        await writeFile(filePath, Buffer.from(`image-${index}`));
        return filePath;
      })
    );

    const result = await new ContextFileService(createFakePlatform()).resolve(filePaths);

    expect(result.images).toHaveLength(21);
    expect(result.imagePaths).toEqual(filePaths);
  });

  it('returns a generated thumbnail instead of the original image data during inspection', async () => {
    const filePath = path.join(tempDir, 'preview.png');
    await writeFile(filePath, Buffer.from('image-data'));

    const [file] = await new ContextFileService(createFakePlatform()).inspectFiles([filePath]);

    expect(file).toMatchObject({
      kind: 'image',
      previewDataUrl: 'data:image/png;base64,dGh1bWI=',
      imageWidth: 1920,
      imageHeight: 1080
    });
    expect(file?.previewDataUrl).not.toContain('aW1hZ2UtZGF0YQ==');
  });

  it('creates a file search placeholder when direct text input budget is exceeded', async () => {
    const filePath = path.join(tempDir, 'huge-novel.txt');
    await writeFile(filePath, '', 'utf8');
    await truncate(filePath, 51 * 1024 * 1024);

    const result = await new ContextFileService(createFakePlatform()).resolve([filePath]);

    expect(result.promptPrefix).toContain('handling="file-search-placeholder"');
    expect(result.promptPrefix).toContain('read/grep/find/ls');
    expect(result.promptPrefix).not.toContain('TODO:');
    expect(result.promptPrefix).toContain('2,000,000 tokens');
  });

  it('keeps valid attachments when another file disappears before resolution', async () => {
    const missingPath = path.join(tempDir, 'missing.txt');
    const validPath = path.join(tempDir, 'valid.txt');
    await writeFile(validPath, '仍然可用的正文', 'utf8');

    const result = await new ContextFileService(createFakePlatform()).resolve([missingPath, validPath]);

    expect(result.promptPrefix).toContain(`path="${missingPath}"`);
    expect(result.promptPrefix).toContain('reason="file-unavailable"');
    expect(result.promptPrefix).toContain('仍然可用的正文');
  });

  it('rejects a directory even when its name uses a supported extension', async () => {
    const directoryPath = path.join(tempDir, 'folder.txt');
    await mkdir(directoryPath);

    const result = await new ContextFileService(createFakePlatform()).resolve([directoryPath]);

    expect(result.promptPrefix).toContain('reason="file-unavailable"');
    expect(result.promptPrefix).toContain('文件可能已被移动、删除或占用');
  });

  it('accepts exactly 2M estimated tokens and uses the placeholder when one token over', async () => {
    const filePath = path.join(tempDir, 'token-heavy.txt');
    await writeFile(filePath, 'abcd'.repeat(2_000_000), 'utf8');

    const boundaryResult = await new ContextFileService(createFakePlatform()).resolve([filePath]);

    expect(boundaryResult.promptPrefix).toContain('handling="file-input-text"');

    await writeFile(filePath, 'abcd'.repeat(2_000_001), 'utf8');
    const overLimitResult = await new ContextFileService(createFakePlatform()).resolve([filePath]);

    expect(overLimitResult.promptPrefix).toContain('handling="file-search-placeholder"');
    expect(overLimitResult.promptPrefix).not.toContain('<content encoding="utf-8">');
  });

  it('accepts an image exactly at the 20 MB boundary', async () => {
    const filePath = path.join(tempDir, 'boundary.png');
    await writeFile(filePath, '');
    await truncate(filePath, 20 * 1024 * 1024);

    const result = await new ContextFileService(createFakePlatform()).resolve([filePath]);

    expect(result.images).toHaveLength(1);
    expect(result.promptPrefix).toBe('');
  });

  it('accepts a document exactly at 512 MB and skips one byte over the boundary', async () => {
    const boundaryPath = path.join(tempDir, 'boundary.pdf');
    const oversizedPath = path.join(tempDir, 'oversized.pdf');
    await writeFile(boundaryPath, '');
    await writeFile(oversizedPath, '');
    await truncate(boundaryPath, 512 * 1024 * 1024);
    await truncate(oversizedPath, 512 * 1024 * 1024 + 1);

    const result = await new ContextFileService(createFakePlatform()).resolve([boundaryPath, oversizedPath]);

    expect(result.promptPrefix).toContain(`path="${boundaryPath}" handling="document-file-input"`);
    expect(result.promptPrefix).toContain(`path="${oversizedPath}" skipped="true" reason="file-too-large"`);
  });

  it('skips oversized prompt images with an explicit context note', async () => {
    const filePath = path.join(tempDir, 'huge.png');
    await writeFile(filePath, Buffer.alloc(21 * 1024 * 1024));

    const result = await new ContextFileService(createFakePlatform()).resolve([filePath]);

    expect(result.images).toEqual([]);
    expect(result.promptPrefix).toContain('kind="image"');
    expect(result.promptPrefix).toContain('skipped="true"');
    expect(result.promptPrefix).toContain('图片超过 20.0 MB');
  });

  it('uses platform dialog for file selection', async () => {
    const filePath = path.join(tempDir, 'note.txt');
    await writeFile(filePath, '正文', 'utf8');
    const platform = createFakePlatform({ selectContextFilePaths: vi.fn(async () => [filePath]) });
    const ownerToken = { id: 'window-1' };

    const files = await new ContextFileService(platform).selectFiles(ownerToken);

    expect(platform.selectContextFilePaths).toHaveBeenCalledWith(ownerToken);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: filePath, kind: 'text' });
  });

  it('drops unsupported files returned by the platform dialog', async () => {
    const filePath = path.join(tempDir, 'archive.zip');
    await writeFile(filePath, Buffer.from('zip'));
    const platform = createFakePlatform({ selectContextFilePaths: vi.fn(async () => [filePath]) });

    await expect(new ContextFileService(platform).selectFiles()).resolves.toEqual([]);
  });
});
