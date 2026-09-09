import { describe, expect, it } from 'vitest';

import { replaceDocumentBody } from '../document-frontmatter';

describe('content body editing', () => {
  it('preserves comments, metadata and CRLF while replacing only the body', () => {
    const header = '\uFEFF---\r\nname: skill # 作者注释\r\ncustom: retained\r\n---\r\n';
    expect(replaceDocumentBody(header + '旧正文\r\n', '新正文\n第二段\n')).toBe(header + '新正文\r\n第二段\r\n');
  });
  it('rejects malformed metadata and accepts empty or headerless bodies', () => {
    expect(() => replaceDocumentBody('---\nname: [\n---\n原稿', '修订')).toThrow();
    expect(replaceDocumentBody('---\nname: skill\n---\n原稿', '')).toBe('---\nname: skill\n---\n');
    expect(replaceDocumentBody('原稿', '修订')).toBe('修订');
  });
});
