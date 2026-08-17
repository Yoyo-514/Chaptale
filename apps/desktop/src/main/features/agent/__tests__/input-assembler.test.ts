import { describe, expect, it, vi } from 'vitest';

import type { ChatImageAttachment } from '@chaptale/shared';

import { InputAssembler } from '../input-assembler';

const CONTEXT_ENVELOPE =
  '<attached_context_files>\n<file path="设定/人物.md" kind="text" size="1 KB" />\n</attached_context_files>\n\n';

function createContextFileService(overrides: Partial<{ promptPrefix: string; images: unknown[] }> = {}) {
  return {
    resolve: vi.fn(async () => ({
      promptPrefix: overrides.promptPrefix ?? '',
      images: overrides.images ?? [],
      imagePaths: []
    }))
  } as never;
}

/** 只回显 sourceFactory 的产物，便于断言 source 定位。 */
const imageAttachmentService = {
  createPresentation: vi.fn((images: Array<{ blockIndex: number }>, sourceFactory?: (index: number) => unknown) => ({
    attachments: images.map(
      image =>
        ({
          type: 'imageAttachment',
          id: `img-${image.blockIndex}`,
          mimeType: 'image/png',
          originalBytes: 3,
          width: 1,
          height: 1,
          thumbnailDataUrl: 'data:image/png;base64,YWJj',
          source: sourceFactory?.(image.blockIndex)
        }) as unknown as ChatImageAttachment
    )
  }))
} as never;

describe('InputAssembler', () => {
  it('纯文本：落盘带记忆前缀，回显只给原文', async () => {
    const assembler = new InputAssembler({});
    const { entry, createEcho } = await assembler.assemble({
      sessionId: 's1',
      query: '继续写第二章',
      memoryPrefix: '<memory>\n林晚左臂为义肢\n</memory>\n\n'
    });

    expect(entry).toEqual({ role: 'user', content: '<memory>\n林晚左臂为义肢\n</memory>\n\n继续写第二章' });
    expect(createEcho('entry-1')).toMatchObject({ role: 'user', content: '继续写第二章' });
  });

  it('附件信封排在记忆之后，contextFiles 元数据随行', async () => {
    const assembler = new InputAssembler({
      contextFileService: createContextFileService({ promptPrefix: CONTEXT_ENVELOPE })
    });
    const { entry, createEcho } = await assembler.assemble({
      sessionId: 's1',
      query: '看下人物设定',
      contextFilePaths: ['设定/人物.md'],
      memoryPrefix: '<memory>\nX\n</memory>\n\n'
    });

    expect(entry.content).toBe(`<memory>\nX\n</memory>\n\n${CONTEXT_ENVELOPE}看下人物设定`);
    expect(entry).toMatchObject({ contextFiles: [{ path: '设定/人物.md', name: '人物.md' }] });
    // 回显不含任何信封。
    expect(createEcho('entry-1')).toMatchObject({ content: '看下人物设定' });
  });

  it('/skill: 调用被展开：命令留在行首，信封作为命令参数注入', async () => {
    // 回归：自有 runtime 曾完全不解析 skill 调用，字面量直接喂给模型。
    const assembler = new InputAssembler({
      contextFileService: createContextFileService({ promptPrefix: CONTEXT_ENVELOPE })
    });
    const { entry, createEcho } = await assembler.assemble({
      sessionId: 's1',
      query: '/skill:review 检查第一章',
      contextFilePaths: ['设定/人物.md']
    });

    expect(entry.content).toBe(`/skill:review ${CONTEXT_ENVELOPE}检查第一章`);
    expect(createEcho('entry-1')).toMatchObject({
      content: '检查第一章',
      skillInvocation: { name: 'review', arguments: '检查第一章' }
    });
  });

  it('图片回显的 source 指向真实 entryId 与落盘下标', async () => {
    // 回归：entryId 曾写死空串，点开原图必然抛「找不到图片所属的会话消息」。
    const assembler = new InputAssembler({
      contextFileService: createContextFileService({
        images: [
          { type: 'image', data: 'YWJj', mimeType: 'image/png' },
          { type: 'image', data: 'ZGVm', mimeType: 'image/png' }
        ]
      }),
      imageAttachmentService
    });
    const { entry, createEcho } = await assembler.assemble({
      sessionId: 's1',
      query: '看这两张图',
      contextFilePaths: ['a.png', 'b.png']
    });

    // 落盘形如 [text, ...images]，图片真实下标从 1 起。
    expect(Array.isArray(entry.content) && entry.content.map(part => part.type)).toEqual(['text', 'image', 'image']);
    const echo = createEcho('entry-42');
    const attachments = Array.isArray(echo.content)
      ? echo.content.filter((part): part is ChatImageAttachment => part.type === 'imageAttachment')
      : [];

    expect(attachments.map(attachment => attachment.source)).toEqual([
      { type: 'session-entry', sessionId: 's1', entryId: 'entry-42', blockIndex: 1 },
      { type: 'session-entry', sessionId: 's1', entryId: 'entry-42', blockIndex: 2 }
    ]);
  });

  it('未装配附件服务时退化为纯文本，不抛错', async () => {
    const assembler = new InputAssembler({});
    const { entry } = await assembler.assemble({
      sessionId: 's1',
      query: '你好',
      contextFilePaths: ['a.md']
    });

    expect(entry).toEqual({ role: 'user', content: '你好' });
  });
});
