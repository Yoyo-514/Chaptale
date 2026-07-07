import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn()
  }
}));

describe('ContextFileService', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-context-file-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('uses basic text file input for text files', async () => {
    const { ContextFileService } = await import('../context-file.service');
    const filePath = path.join(tempDir, 'note.txt');
    await writeFile(filePath, '第一章 开始\n正文内容', 'utf8');

    const result = await new ContextFileService().resolve([filePath]);

    expect(result.promptPrefix).toContain('<attached_context_files>');
    expect(result.promptPrefix).toContain('handling="file-input-text"');
    expect(result.promptPrefix).toContain('用户随消息提供的文件内容');
    expect(result.promptPrefix).toContain('第一章 开始');
    expect(result.promptPrefix).toContain('正文内容');
    expect(result.promptPrefix).not.toContain('long-text-context-pack');
  });

  it('uses basic text file input for large novels within direct input budget', async () => {
    const { ContextFileService } = await import('../context-file.service');
    const filePath = path.join(tempDir, 'novel.txt');
    const chapters = Array.from({ length: 12 }, (_, index) => {
      const chapterNumber = index + 1;
      return `第${chapterNumber}章 标题${chapterNumber}\n${'这是一段小说正文。'.repeat(9000)}`;
    });
    await writeFile(filePath, chapters.join('\n\n'), 'utf8');

    const result = await new ContextFileService().resolve([filePath]);

    expect(result.promptPrefix).toContain('handling="file-input-text"');
    expect(result.promptPrefix).toContain('用户随消息提供的文件内容');
    expect(result.promptPrefix).not.toContain('File Search/RAG');
    expect(result.promptPrefix).toContain('第1章 标题1');
    expect(result.promptPrefix).toContain('第12章 标题12');
    expect(result.promptPrefix).toContain('这是一段小说正文。');
    expect(result.promptPrefix).not.toContain('已跳过全文注入');
  });

  it('does not cap the number of selected context files in main-side inspection', async () => {
    const { ContextFileService } = await import('../context-file.service');
    const filePaths = await Promise.all(
      Array.from({ length: 12 }, async (_, index) => {
        const filePath = path.join(tempDir, `note-${index}.txt`);
        await writeFile(filePath, `内容 ${index}`, 'utf8');
        return filePath;
      })
    );

    const inspected = await new ContextFileService().inspectFiles(filePaths);

    expect(inspected).toHaveLength(12);
  });

  it('accepts PDF and common document files as document inputs', async () => {
    const { ContextFileService } = await import('../context-file.service');
    const filePath = path.join(tempDir, 'paper.pdf');
    await writeFile(filePath, Buffer.from('%PDF-1.7\n% mock pdf'));

    const [inspected] = await new ContextFileService().inspectFiles([filePath]);
    const result = await new ContextFileService().resolve([filePath]);

    expect(inspected).toMatchObject({ kind: 'document', mimeType: 'application/pdf' });
    expect(result.promptPrefix).toContain('handling="document-file-input"');
    expect(result.promptPrefix).toContain('application/pdf');
    expect(result.promptPrefix).toContain('当前消息包含文件元数据与本地路径');
  });

  it('creates a file search placeholder when direct text input budget is exceeded', async () => {
    const { ContextFileService } = await import('../context-file.service');
    const filePath = path.join(tempDir, 'huge-novel.txt');
    await writeFile(filePath, '', 'utf8');
    await truncate(filePath, 51 * 1024 * 1024);

    const result = await new ContextFileService().resolve([filePath]);

    expect(result.promptPrefix).toContain('handling="file-search-placeholder"');
    expect(result.promptPrefix).toContain('read/grep/find/ls');
    expect(result.promptPrefix).not.toContain('TODO:');
    expect(result.promptPrefix).toContain('2,000,000 tokens');
  });

  it('skips oversized prompt images with an explicit context note', async () => {
    const { ContextFileService } = await import('../context-file.service');
    const filePath = path.join(tempDir, 'huge.png');
    await writeFile(filePath, Buffer.alloc(21 * 1024 * 1024));

    const result = await new ContextFileService().resolve([filePath]);

    expect(result.images).toEqual([]);
    expect(result.promptPrefix).toContain('kind="image"');
    expect(result.promptPrefix).toContain('skipped="true"');
    expect(result.promptPrefix).toContain('图片超过 20.0 MB');
  });
});
