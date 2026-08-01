import { describe, expect, it, vi } from 'vitest';

import { InputAssembler } from '../input-assembler';

const passthroughImages = {
  createPresentation: vi.fn(() => ({ attachments: [] }))
};
const signal = new AbortController().signal;

describe('InputAssembler', () => {
  it('places memory prefix before context files and keeps decoded context metadata', async () => {
    const contextFileService = {
      resolve: vi.fn(async () => ({
        promptPrefix: '<attached_context_files>\n<file path="a.txt">正文</file>\n</attached_context_files>\n\n',
        images: [],
        imagePaths: []
      }))
    };
    const assembler = new InputAssembler({ contextFileService, imageAttachmentService: passthroughImages });

    const result = await assembler.assemble({
      options: { sessionId: 's1', query: '继续', signal, contextFilePaths: ['a.txt'] }
    });

    expect(result.promptText).toBe(
      '<attached_context_files>\n<file path="a.txt">正文</file>\n</attached_context_files>\n\n继续'
    );
    expect((result.userMessage as any).contextFiles).toHaveLength(1);
    expect(contextFileService.resolve).toHaveBeenCalledWith(['a.txt'], { query: '继续', signal });

    const withMemory = await assembler.assemble({
      options: { sessionId: 's1', query: '继续', signal, contextFilePaths: ['a.txt'] },
      memoryPrefix: '<memory>m</memory>\n\n'
    });

    expect(withMemory.promptText.startsWith('<memory>m</memory>\n\n<attached_context_files>')).toBe(true);
    expect((withMemory.userMessage as any).contextFiles).toHaveLength(1);
  });

  it('reuses original prompt prefix and formats skill invocation without resolving files again', async () => {
    const contextFileService = { resolve: vi.fn() };
    const assembler = new InputAssembler({ contextFileService, imageAttachmentService: passthroughImages });

    const result = await assembler.assemble({
      options: { sessionId: 's1', query: '/skill:novel arg', signal, reuseUserEntryId: 'u1' },
      reusedContext: {
        promptPrefix: '<attached_context_files>\n<file path="old.txt">旧</file>\n</attached_context_files>\n\n',
        imageBlocks: []
      }
    });

    expect(contextFileService.resolve).not.toHaveBeenCalled();
    expect(result.promptText).toContain('/skill:novel');
    expect(result.promptText).toContain('old.txt');
    expect((result.userMessage as any).skillInvocation?.name).toBe('novel');
  });

  it('builds context-file image attachments with stable source mapping', async () => {
    const image = { type: 'image' as const, data: 'aW1hZ2U=', mimeType: 'image/png' };
    const contextFileService = {
      resolve: vi.fn(async () => ({ promptPrefix: '', images: [image], imagePaths: ['/work/cover.png'] }))
    };
    const imageAttachmentService = {
      createPresentation: vi.fn(() => ({
        attachments: [{ type: 'imageAttachment' as const, id: 'context-file:/work/cover.png' } as any]
      }))
    };
    const assembler = new InputAssembler({ contextFileService, imageAttachmentService });

    const result = await assembler.assemble({
      options: { sessionId: 's1', query: '看图', signal, contextFilePaths: ['/work/cover.png'] }
    });

    expect(result.promptImages).toEqual([image]);
    expect(imageAttachmentService.createPresentation).toHaveBeenCalledWith(
      [{ ...image, blockIndex: 1 }],
      expect.any(Function)
    );

    const resolveSource = (imageAttachmentService.createPresentation.mock.calls[0] as any)?.[1];
    expect(resolveSource(1)).toEqual({ type: 'context-file', path: '/work/cover.png' });
    expect(resolveSource(2)).toBeUndefined();
  });

  it('maps reused images back to the original session entry blocks', async () => {
    const imageAttachmentService = { createPresentation: vi.fn(() => ({ attachments: [] })) };
    const assembler = new InputAssembler({
      contextFileService: { resolve: vi.fn() },
      imageAttachmentService
    });

    await assembler.assemble({
      options: { sessionId: 's1', query: '再看一次', signal, reuseUserEntryId: 'entry-9' },
      reusedContext: {
        promptPrefix: '',
        imageBlocks: [{ type: 'image', data: 'aW1n', mimeType: 'image/png', blockIndex: 3 }]
      }
    });

    const resolveSource = (imageAttachmentService.createPresentation.mock.calls[0] as any)?.[1];
    expect(resolveSource(3)).toEqual({
      type: 'session-entry',
      sessionId: 's1',
      entryId: 'entry-9',
      blockIndex: 3
    });
  });
});
