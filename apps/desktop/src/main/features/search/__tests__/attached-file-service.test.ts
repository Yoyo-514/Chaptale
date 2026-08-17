import { describe, expect, it } from 'vitest';

import { AttachedFileSearchService } from '../attached-file-service';

const service = new AttachedFileSearchService();

describe('AttachedFileSearchService', () => {
  it('uses the existing keyword index to select query-related sections', async () => {
    const text = `# 世界观\n北境终年积雪，王都位于南方。\n\n# 角色\n林晚是义肢师学徒，左眼已经失明。`;

    const snippets = await service.search({
      sourcePath: '资料.docx',
      text,
      query: '林晚的职业和伤势是什么？',
      maxTokens: 800
    });

    expect(snippets).toHaveLength(1);
    expect(snippets[0]?.headingPath).toEqual(['角色']);
    expect(snippets[0]?.body).toContain('义肢师学徒');
    expect(snippets[0]?.body).toContain('左眼已经失明');
  });

  it('uses bounded literal windows for large attachments', async () => {
    const line = '普通背景资料。\n';
    const repeats = Math.ceil((4 * 1024 * 1024 + 1) / Buffer.byteLength(line, 'utf8'));
    const text = `${line.repeat(repeats)}银月钥匙藏在北塔第三层。`;

    const snippets = await service.search({
      sourcePath: '大型资料.txt',
      text,
      query: '银月钥匙藏在哪里？',
      maxTokens: 800
    });

    expect(snippets.some(snippet => snippet.body.includes('北塔第三层'))).toBe(true);
  });

  it('falls back to the first chunk when the query has no lexical match', async () => {
    const snippets = await service.search({
      sourcePath: '资料.txt',
      text: '第一段可用资料。\n\n第二段补充资料。',
      query: '完全不存在的英文词 quantum',
      maxTokens: 800
    });

    expect(snippets[0]?.body).toContain('第一段可用资料');
  });

  it('never exceeds the caller token budget', async () => {
    const snippets = await service.search({
      sourcePath: '长文.txt',
      text: '很长的内容。'.repeat(2_000),
      query: '',
      maxTokens: 50
    });

    expect(snippets).toHaveLength(1);
    expect([...snippets[0]!.body].length).toBeLessThanOrEqual(50);
  });

  it('honors a pre-aborted request', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      service.search({ sourcePath: '资料.txt', text: '正文', query: '正文', maxTokens: 100, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
