import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';

import { validateToolArguments } from '../validation';

/**
 * 入参校验验收。
 *
 * 修复前 `dynamicTool` 不校验任何东西：模型发 `{wrong_key:123}` 时工具照常执行、
 * 内部拿到 `undefined`。这一组把「非法参数不得进入 execute」钉死。
 */

const readParams = Type.Object(
  {
    path: Type.String(),
    limit: Type.Optional(Type.Integer({ minimum: 1 }))
  },
  { additionalProperties: false }
);

describe('validateToolArguments', () => {
  it('合法参数原样通过', () => {
    const result = validateToolArguments('read', readParams, { path: '第三章.md', limit: 20 });

    expect(result).toEqual({ ok: true, value: { path: '第三章.md', limit: 20 } });
  });

  it('无歧义的表述差异被收编：字符串数字 → 整数', () => {
    const result = validateToolArguments('read', readParams, { path: 'a.md', limit: '20' });

    // 这类差异不值得占用一轮往返，Convert 收编后继续执行。
    expect(result).toMatchObject({ ok: true, value: { limit: 20 } });
  });

  it('缺必填字段：拒绝执行，诊断指出字段名', () => {
    const result = validateToolArguments('read', readParams, { limit: 5 });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('read');
    expect(result.ok === false && result.message).toContain('path');
  });

  it('未知字段（additionalProperties: false）被拒，且回显模型实际发出的参数', () => {
    const result = validateToolArguments('read', readParams, { wrong_key: 123 });

    expect(result.ok).toBe(false);
    // 回显是关键：模型据此看到自己发了什么，才能自行改正重发。
    expect(result.ok === false && result.message).toContain('wrong_key');
  });

  it('不污染调用方持有的原始参数（落盘与授权卡片仍看到原样输入）', () => {
    const original = { path: 'a.md', limit: '20' };

    validateToolArguments('read', readParams, original);

    expect(original.limit).toBe('20');
  });

  it('超长参数回显被截断：write 类工具可能带整章正文', () => {
    const writeParams = Type.Object({ path: Type.String(), content: Type.String() }, { additionalProperties: false });
    const result = validateToolArguments('write', writeParams, { content: '正'.repeat(5000) });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('已截断');
    expect(result.ok === false && result.message.length).toBeLessThan(2500);
  });

  it('顶层联合 schema 同样可校验（getSearchContent 是这种形状）', () => {
    const unionParams = Type.Union([
      Type.Object({ query: Type.String() }, { additionalProperties: false }),
      Type.Object({ url: Type.String() }, { additionalProperties: false })
    ]);

    expect(validateToolArguments('get', unionParams, { url: 'https://x' }).ok).toBe(true);
    expect(validateToolArguments('get', unionParams, { nope: 1 }).ok).toBe(false);
  });
});
