import path from 'node:path';
import type { OfficeParserAST, OfficeParserConfig, parseOffice } from 'officeparser';
import { describe, expect, it, vi } from 'vitest';

import { OfficeDocumentParser } from '../parser';

function createAst(text = '解析后的正文'): OfficeParserAST {
  return {
    warnings: [{ type: 'warning', code: 'PAGE_LOAD_FAILED', message: '第二页读取失败' }],
    to: vi.fn(async () => ({ value: text }))
  } as unknown as OfficeParserAST;
}

type ParseOffice = typeof parseOffice;

describe('OfficeDocumentParser', () => {
  it('只接受 officeparser 原生支持的文档扩展名', () => {
    const parser = new OfficeDocumentParser();

    for (const file of ['a.pdf', 'a.docx', 'a.pptx', 'a.xlsx', 'a.rtf', 'a.odt', 'a.odp', 'a.ods']) {
      expect(parser.supports(file)).toBe(true);
    }
    for (const file of ['a.doc', 'a.ppt', 'a.xls', 'a.txt', 'a.png']) {
      expect(parser.supports(file)).toBe(false);
    }
  });

  it.each([
    ['sample.pdf', 'Chaptale PDF text'],
    ['sample.docx', 'Chaptale DOCX 正文'],
    ['sample.pptx', 'Chaptale PPTX 幻灯片'],
    ['sample.xlsx', 'Chaptale XLSX 单元格']
  ])('从真实的最小 %s 夹具提取原生文本', async (fileName, expectedText) => {
    const parser = new OfficeDocumentParser();

    const result = await parser.parse(path.join(import.meta.dirname, 'fixtures', fileName));

    expect(result.text).toContain(expectedText);
  });

  it('rejects a corrupt OOXML document instead of returning empty text', async () => {
    const parser = new OfficeDocumentParser();

    await expect(parser.parse(path.join(import.meta.dirname, 'fixtures', 'corrupt.docx'))).rejects.toThrow();
  });

  it('永久关闭 OCR、附件与原始内容并施加资源限制', async () => {
    const parseStub = vi.fn(async (_file: string | Buffer | ArrayBuffer | Uint8Array, _config?: OfficeParserConfig) =>
      createAst()
    );
    const parser = new OfficeDocumentParser({ parseOffice: parseStub as unknown as ParseOffice });

    await expect(parser.parse('draft.docx')).resolves.toEqual({
      text: '解析后的正文',
      warnings: [{ code: 'PAGE_LOAD_FAILED', message: '第二页读取失败' }]
    });

    const config = parseStub.mock.calls[0]?.[1] as OfficeParserConfig;
    expect(config).toMatchObject({
      extractAttachments: false,
      includeRawContent: false,
      ocr: false,
      ignoreSlideMasters: true,
      decompressionLimits: {
        maxUncompressedBytes: 128 * 1024 * 1024,
        maxZipEntries: 5_000,
        maxTableCells: 100_000
      }
    });
    expect(config.ocrConfig).toBeUndefined();
    expect(config.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('调用前已取消时不启动解析', async () => {
    const parseStub = vi.fn(async (_file: string | Buffer | ArrayBuffer | Uint8Array, _config?: OfficeParserConfig) =>
      createAst()
    );
    const parser = new OfficeDocumentParser({ parseOffice: parseStub as unknown as ParseOffice });
    const controller = new AbortController();
    controller.abort();

    await expect(parser.parse('draft.docx', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(parseStub).not.toHaveBeenCalled();
  });

  it('超过适配器时限时中止解析', async () => {
    const parseStub = vi.fn(
      (_file: string | Buffer | ArrayBuffer | Uint8Array, config?: OfficeParserConfig) =>
        new Promise<OfficeParserAST>((_resolve, reject) => {
          config?.abortSignal?.addEventListener('abort', () => reject(config.abortSignal?.reason), { once: true });
        })
    );
    const parser = new OfficeDocumentParser({ parseOffice: parseStub as unknown as ParseOffice, timeoutMs: 5 });

    await expect(parser.parse('slow.pdf')).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
