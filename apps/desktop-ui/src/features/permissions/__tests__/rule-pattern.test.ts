import { describe, expect, it } from 'vitest';

import { deriveScopedRule } from '../utils/rule-pattern';

describe('deriveScopedRule', () => {
  it('路径摘要授到所在目录', () => {
    expect(deriveScopedRule('write', '小说/第一章.md')).toEqual({
      pattern: 'write(小说/*)',
      scopeLabel: '小说/'
    });
  });

  it('多层路径只授到直接父目录，不向上放宽', () => {
    expect(deriveScopedRule('edit', '小说/卷一/第三章.md')?.pattern).toBe('edit(小说/卷一/*)');
  });

  it('Windows 分隔符同样识别', () => {
    expect(deriveScopedRule('write', '设定\\人物.md')?.pattern).toBe('write(设定\\*)');
  });

  it('URL 授到来源而非整条地址', () => {
    expect(deriveScopedRule('fetch_content', 'https://example.com/a/b?q=1')).toEqual({
      pattern: 'fetch_content(https://example.com/*)',
      scopeLabel: 'https://example.com'
    });
  });

  it('无路径结构的摘要精确匹配，不做猜测性放宽', () => {
    expect(deriveScopedRule('write', '大纲.md')?.pattern).toBe('write(大纲.md)');
    expect(deriveScopedRule('web_search', '林晚 义肢')?.pattern).toBe('web_search(林晚 义肢)');
  });

  it('摘要缺失或为空白时不给参数级规则', () => {
    expect(deriveScopedRule('write', undefined)).toBeUndefined();
    expect(deriveScopedRule('write', '   ')).toBeUndefined();
  });

  it('摘要恰为工具名时与裸工具名等价，不重复给一个按钮', () => {
    expect(deriveScopedRule('write', 'write')).toBeUndefined();
  });

  it('前导斜杠的绝对路径不会退化成放行全部', () => {
    // separator > 0 的判定保证 "/a.md" 不会生成 "write(*)" 这种等同于放行一切的规则。
    expect(deriveScopedRule('write', '/a.md')?.pattern).toBe('write(/a.md)');
  });
});
