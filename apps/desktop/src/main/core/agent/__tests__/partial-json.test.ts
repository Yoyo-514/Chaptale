import { describe, expect, it } from 'vitest';

import { parsePartialJsonObject } from '../partial-json';

/**
 * 工具参数边生成边到达，半截 JSON 必须能读出已完整的字段——
 * 否则"正在写入哪个文件"要等整章正文生成完才显示得出来。
 */
describe('parsePartialJsonObject', () => {
  it('完整 JSON 原样解析', () => {
    expect(parsePartialJsonObject('{"path":"第三章.md","content":"雨夜"}')).toEqual({
      path: '第三章.md',
      content: '雨夜'
    });
  });

  it('值还在生成中：补齐字符串与括号，已完整的字段可读', () => {
    expect(parsePartialJsonObject('{"path":"第三章.md","content":"雨夜，林晚推开')).toEqual({
      path: '第三章.md',
      content: '雨夜，林晚推开'
    });
  });

  it('键还没配上值：丢掉这一段，保住前面完整的字段', () => {
    expect(parsePartialJsonObject('{"path":"第三章.md","con')).toEqual({ path: '第三章.md' });
    expect(parsePartialJsonObject('{"path":"第三章.md","content"')).toEqual({ path: '第三章.md' });
    expect(parsePartialJsonObject('{"path":"第三章.md","content":')).toEqual({ path: '第三章.md' });
  });

  it('嵌套结构逐层补齐', () => {
    expect(parsePartialJsonObject('{"filters":{"tags":["伏笔","雨')).toEqual({ filters: { tags: ['伏笔', '雨'] } });
  });

  it('字符串里的引号与转义不误判', () => {
    expect(parsePartialJsonObject('{"content":"他说\\"走吧')).toEqual({ content: '他说"走吧' });
    // 末尾悬空的转义符不能带进补齐，否则会把闭合引号吃掉。
    expect(parsePartialJsonObject('{"content":"换行\\')).toEqual({ content: '换行' });
    // 逗号在字符串里，不算字段分隔。
    expect(parsePartialJsonObject('{"content":"一，二，三')).toEqual({ content: '一，二，三' });
  });

  it('刚开头时给出空对象，不猜内容', () => {
    expect(parsePartialJsonObject('{')).toEqual({});
  });

  it('补不出合法 JSON 就返回 undefined，不显示半个错的值', () => {
    // 第一个键都还没写完：没有任何可信字段。
    expect(parsePartialJsonObject('{"pa')).toBeUndefined();
    expect(parsePartialJsonObject('')).toBeUndefined();
    expect(parsePartialJsonObject('不是 JSON')).toBeUndefined();
    // 数组不是工具参数的形状。
    expect(parsePartialJsonObject('["a"]')).toBeUndefined();
  });
});
