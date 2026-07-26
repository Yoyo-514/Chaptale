import { afterEach, describe, expect, it, vi } from 'vitest';

const nativeImageMock = vi.hoisted(() => ({ createFromBuffer: vi.fn() }));

vi.mock('electron', () => ({ nativeImage: nativeImageMock }));

import { createElectronThumbnail, createInlineImageDataUrl, createNativeThumbnail } from '../thumbnail';

afterEach(() => {
  vi.clearAllMocks();
});

function mockDecodedImage(width: number, height: number) {
  const resized = { toDataURL: () => 'data:image/png;base64,cmVzaXplZA==' };
  nativeImageMock.createFromBuffer.mockReturnValue({
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: vi.fn(() => resized),
    toDataURL: () => 'data:image/png;base64,b3JpZ2luYWw='
  });
  return resized;
}

describe('createNativeThumbnail', () => {
  it('reports the original size while downscaling the longest edge to 256', () => {
    mockDecodedImage(1920, 1080);

    const thumbnail = createNativeThumbnail(Buffer.from('image'));

    expect(thumbnail).toEqual({ dataUrl: 'data:image/png;base64,cmVzaXplZA==', width: 1920, height: 1080 });
    expect(nativeImageMock.createFromBuffer.mock.results[0]?.value.resize).toHaveBeenCalledWith({
      width: 256,
      height: 144,
      quality: 'good'
    });
  });

  it('keeps images already within the thumbnail limit unresized', () => {
    mockDecodedImage(128, 64);

    const thumbnail = createNativeThumbnail(Buffer.from('image'));

    expect(thumbnail.dataUrl).toBe('data:image/png;base64,b3JpZ2luYWw=');
    expect(nativeImageMock.createFromBuffer.mock.results[0]?.value.resize).not.toHaveBeenCalled();
  });

  it('throws when the platform cannot decode the image', () => {
    nativeImageMock.createFromBuffer.mockReturnValue({ isEmpty: () => true });

    expect(() => createNativeThumbnail(Buffer.from('broken'))).toThrow('无法解码图片');
  });
});

describe('createInlineImageDataUrl', () => {
  it('inlines small images as a data url', () => {
    expect(createInlineImageDataUrl(Buffer.from('abc'), 'image/webp')).toBe('data:image/webp;base64,YWJj');
  });

  it('refuses empty payloads and images over the inline fallback limit', () => {
    expect(createInlineImageDataUrl(Buffer.alloc(0), 'image/webp')).toBeUndefined();
    expect(createInlineImageDataUrl(Buffer.alloc(2 * 1024 * 1024 + 1), 'image/webp')).toBeUndefined();
  });
});

describe('createElectronThumbnail', () => {
  it('falls back to the inline original when nativeImage decoding fails for a small image', () => {
    nativeImageMock.createFromBuffer.mockReturnValue({ isEmpty: () => true });

    expect(createElectronThumbnail(Buffer.from('abc'), 'image/webp')).toEqual({
      dataUrl: 'data:image/webp;base64,YWJj',
      width: 0,
      height: 0
    });
  });

  it('returns undefined for undecodable images beyond the inline fallback limit', () => {
    nativeImageMock.createFromBuffer.mockReturnValue({ isEmpty: () => true });

    // 4MB 图片超过内联兜底阈值（2MB）。
    expect(createElectronThumbnail(Buffer.alloc(4 * 1024 * 1024), 'image/webp')).toBeUndefined();
  });

  it('returns undefined for empty payloads and images over the chat image limit', () => {
    expect(createElectronThumbnail(Buffer.alloc(0), 'image/png')).toBeUndefined();
    expect(createElectronThumbnail(Buffer.alloc(21 * 1024 * 1024), 'image/png')).toBeUndefined();
    expect(nativeImageMock.createFromBuffer).not.toHaveBeenCalled();
  });
});
