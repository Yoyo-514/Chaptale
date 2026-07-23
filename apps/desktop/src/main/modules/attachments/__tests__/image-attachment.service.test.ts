import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ImageAttachmentService } from '../service';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

function createService() {
  return new ImageAttachmentService(
    vi.fn(() => ({ dataUrl: 'data:image/png;base64,dGh1bWI=', width: 1920, height: 1080 }))
  );
}

describe('ImageAttachmentService', () => {
  it('creates thumbnails for every valid image without a per-message count limit', () => {
    const service = createService();
    const images = Array.from({ length: 12 }, (_, index) => ({
      type: 'image' as const,
      data: 'YWJj',
      mimeType: 'image/png',
      blockIndex: index + 1
    }));

    const result = service.createPresentation(images, blockIndex => ({
      type: 'session-entry',
      sessionId: 'session-1',
      entryId: 'entry-1',
      blockIndex
    }));

    expect(result.attachments).toHaveLength(12);
    expect(result.attachments[11]).toMatchObject({
      type: 'imageAttachment',
      id: 'session-1:entry-1:12',
      originalBytes: 3,
      width: 1920,
      height: 1080,
      source: { type: 'session-entry', sessionId: 'session-1', entryId: 'entry-1', blockIndex: 12 }
    });
  });

  it('falls back to the inline original when thumbnail decoding fails for a small image', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = new ImageAttachmentService(
      vi.fn(() => {
        throw new Error('无法解码图片');
      })
    );

    const result = service.createPresentation([{ type: 'image', data: 'YWJj', mimeType: 'image/webp', blockIndex: 1 }]);

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      type: 'imageAttachment',
      mimeType: 'image/webp',
      thumbnailDataUrl: 'data:image/webp;base64,YWJj',
      width: 0,
      height: 0
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('skips undecodable oversized images with a warning instead of failing silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = new ImageAttachmentService(
      vi.fn(() => {
        throw new Error('无法解码图片');
      })
    );
    // 4MB 图片超过内联兜底阈值（2MB）。
    const oversized = Buffer.alloc(4 * 1024 * 1024).toString('base64');

    const result = service.createPresentation([
      { type: 'image', data: oversized, mimeType: 'image/webp', blockIndex: 1 }
    ]);

    expect(result.attachments).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns and skips image blocks whose base64 payload is invalid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = createService();

    const result = service.createPresentation([
      { type: 'image', data: '!!!not-base64!!!', mimeType: 'image/png', blockIndex: 1 }
    ]);

    expect(result.attachments).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reads exactly the requested local image block', () => {
    const service = createService();
    const images = [
      { type: 'image' as const, data: 'YWJj', mimeType: 'image/png', blockIndex: 1 },
      { type: 'image' as const, data: 'ZGVm', mimeType: 'image/webp', blockIndex: 2 }
    ];

    expect(service.readOriginal(images, 2)).toEqual({
      data: new Uint8Array(Buffer.from('def')),
      mimeType: 'image/webp'
    });
    expect(() => service.readOriginal(images, 3)).toThrow('图片不存在');
  });

  it('reads a current context image after revalidating its path and size', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-image-'));
    tempDirs.push(tempDir);
    const imagePath = path.join(tempDir, 'cover.png');
    await writeFile(imagePath, Buffer.from('abc'));
    const service = createService();

    await expect(service.readContextFile(imagePath)).resolves.toEqual({
      data: new Uint8Array(Buffer.from('abc')),
      mimeType: 'image/png'
    });
    await expect(service.readContextFile(path.join(tempDir, 'missing.png'))).rejects.toThrow();
  });
});
