import { describe, expect, it } from 'vitest';

import { estimateTextTokens } from '../../../core/context/token-counter';
import { chunkMarkdownDocument } from '../markdown-chunker';
import type { IndexSourceDocument } from '../types';

function document(body: string): IndexSourceDocument {
  return {
    sourcePath: '角色/林晚.md',
    domain: 'canon',
    role: 'characters',
    title: '林晚',
    kind: 'character',
    aliases: [],
    searchAliases: [],
    links: [],
    body,
    size: Buffer.byteLength(body),
    mtimeMs: 1
  };
}

describe('chunkMarkdownDocument', () => {
  it('按标题层级生成 breadcrumb 与相邻引用', () => {
    const body = '# 人物档案\n\n总览。\n\n## 经历\n\n加入机械师公会。\n\n### 转折\n\n发现灵脉共振。';

    const chunks = chunkMarkdownDocument(document(body));

    expect(chunks.map(chunk => chunk.headingPath)).toEqual([
      ['人物档案'],
      ['人物档案', '经历'],
      ['人物档案', '经历', '转折']
    ]);
    expect(chunks[0].nextId).toBe(chunks[1].id);
    expect(chunks[1].previousId).toBe(chunks[0].id);
    expect(chunks[2].body).toContain('发现灵脉共振');
  });

  it('长正文遵守 1000/200 token 预算且区间无缺口', () => {
    const body = `# 长章\n\n${'中'.repeat(2_300)}`;
    const chunks = chunkMarkdownDocument(document(body), { maxTokens: 1_000, overlapTokens: 200 });

    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(estimateTextTokens(`${chunk.headingPath.join(' / ')}\n${chunk.body}`)).toBeLessThanOrEqual(1_000);
    }
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index].startOffset).toBeLessThan(chunks[index - 1].endOffset);
      expect(chunks[index].startOffset).toBeLessThanOrEqual(chunks[index - 1].endOffset);
    }

    const firstContentOffset = body.indexOf('中');
    expect(chunks[0].startOffset).toBe(firstContentOffset);
    expect(chunks.at(-1)?.endOffset).toBe(body.length);
  });

  it('保留表格、引用和代码块原文', () => {
    const body =
      '# 设定\n\n| 名称 | 值 |\n| --- | --- |\n| 灵脉 | 开启 |\n\n> 不得改写\n\n```ts\nconst state = true;\n```';

    const [chunk] = chunkMarkdownDocument(document(body));

    expect(chunk.body).toContain('| 灵脉 | 开启 |');
    expect(chunk.body).toContain('> 不得改写');
    expect(chunk.body).toContain('const state = true;');
    expect(body.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.body);
  });
});
