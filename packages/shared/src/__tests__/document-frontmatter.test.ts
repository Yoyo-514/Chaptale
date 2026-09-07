import { describe, expect, it } from 'vitest';

import { parseDocumentFrontmatter, patchDocumentFields } from '../document-frontmatter';

describe('表单与原文投影', () => {
  it('只改声明字段，未知 YAML、注释、BOM 与混合换行原样保留', () => {
    const unknown = '# 未知字段的注释\r\ncustom: { value: 0xFF, list: [甲, 乙] } # 保留格式\r\n';
    const source = `\uFEFF---\r\ntitle: 旧名\r\n${unknown}goal: |\r\n  保留目标\r\n---\r\n正文第一行\n第二行\r`;
    const changed = patchDocumentFields(source, { title: '新名' });
    expect(changed).toBe(source.replace('title: 旧名', 'title: 新名'));
    expect(patchDocumentFields(changed, { cast: ['[[甲]]', '[[乙]]'], settled: false })).toContain(unknown);
    expect(parseDocumentFrontmatter(changed)).toMatchObject({
      status: 'ok',
      frontmatter: { title: '新名' },
      body: '正文第一行\n第二行\r'
    });
  });
  it('支持新增、移除、空字段、数组和多行文本，正文不变', () => {
    const source = '---\ntitle: 甲\nempty:\ncast: [旧]\n---\n正文';
    const changed = patchDocumentFields(source, { title: null, empty: '值', cast: ['[[乙]]'], goal: '第一步\n第二步' });
    expect(parseDocumentFrontmatter(changed)).toEqual({
      status: 'ok',
      frontmatter: {
        empty: '值',
        cast: ['[[乙]]'],
        goal: '第一步\n第二步'
      },
      body: '正文'
    });
    expect(patchDocumentFields('无元数据\r\n正文', { kind: 'scene-card', title: '目标' })).toContain(
      '---\r\n无元数据\r\n正文'
    );
  });
  it('坏 YAML、别名、重复键、超长元数据及原型键不被表单覆盖', () => {
    for (const head of ['title: [坏', 'a: &a 值\nb: *a', 'title: 甲\ntitle: 乙', 'a: !unknown 值']) {
      const raw = `---\n${head}\n---\n正文`;
      expect(parseDocumentFrontmatter(raw).status).toBe('invalid');
      expect(() => patchDocumentFields(raw, { title: '新' })).toThrow();
    }
    expect(() => patchDocumentFields('正文', { title: '字'.repeat(30_000) })).toThrow('64 KiB');
    expect(() => patchDocumentFields('正文', JSON.parse('{"__proto__":"bad"}'))).toThrow('字段名称');
  });
});
