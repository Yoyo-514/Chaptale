import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';

import { extractTaskOutput, getOutputSchema, registerOutputSchema, validateOutput } from '@chaptale/shared';

describe('extractTaskOutput', () => {
  it('提取标签内的 JSON 对象', () => {
    const result = extractTaskOutput('<output>{"summary":"ok","issues":[]}</output>');
    expect(result).toEqual({
      ok: true,
      raw: '{"summary":"ok","issues":[]}',
      value: { summary: 'ok', issues: [] }
    });
  });

  it('容忍标签前后的解释文字', () => {
    const text = '好的，我完成了审校，结果如下：\n<output>{"a":1}</output>\n以上就是全部内容。';
    const result = extractTaskOutput(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ a: 1 });
    }
  });

  it('剥离 ```json 代码围栏', () => {
    const text = '<output>\n```json\n{"a": true}\n```\n</output>';
    const result = extractTaskOutput(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.raw).toBe('{"a": true}');
      expect(result.value).toEqual({ a: true });
    }
  });

  it('剥离无语言标注的代码围栏', () => {
    const text = '<output>```\n[1,2,3]\n```</output>';
    const result = extractTaskOutput(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([1, 2, 3]);
    }
  });

  it('多个 output 标签时取最后一个', () => {
    const text = '<output>{"v":1}</output>\n刚才有误，修正如下：\n<output>{"v":2}</output>';
    const result = extractTaskOutput(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ v: 2 });
    }
  });

  it('内容跨多行也能匹配', () => {
    const text = '<output>\n{\n  "multi": "line"\n}\n</output>';
    const result = extractTaskOutput(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ multi: 'line' });
    }
  });

  it('无标签时返回 missing-output-tag', () => {
    const result = extractTaskOutput('这段文本没有任何输出标签。');
    expect(result).toMatchObject({ ok: false, reason: 'missing-output-tag' });
  });

  it('标签不完整（只有开标签）时返回 missing-output-tag', () => {
    const result = extractTaskOutput('<output>{"a":1}');
    expect(result).toMatchObject({ ok: false, reason: 'missing-output-tag' });
  });

  it('标签内不是合法 JSON 时返回 invalid-json 且不抛异常', () => {
    const result = extractTaskOutput('<output>这不是 JSON</output>');
    expect(result).toMatchObject({ ok: false, reason: 'invalid-json' });
    if (!result.ok) {
      expect(result.message).toContain('JSON');
    }
  });
});

describe('输出 schema 注册表', () => {
  it('注册后可以按 id 查到 schema', () => {
    const schema = Type.Object({ n: Type.Number() });
    registerOutputSchema('test-numeric', schema);
    expect(getOutputSchema('test-numeric')).toBe(schema);
  });

  it('未注册的 id 返回 undefined', () => {
    expect(getOutputSchema('nonexistent-schema')).toBeUndefined();
  });

  it('内置 continuity-issues schema 默认已注册', () => {
    expect(getOutputSchema('continuity-issues')).toBeDefined();
  });

  it('内置 creative-checkpoint schema 默认已注册', () => {
    expect(getOutputSchema('creative-checkpoint')).toBeDefined();
  });
});

describe('validateOutput', () => {
  const validPayload = {
    issues: [
      {
        id: 'issue-1',
        severity: 'high',
        location: '第三章第二节',
        description: '主角眼睛颜色前后不一致',
        suggestion: '统一为金色'
      },
      {
        id: 'issue-2',
        severity: 'low',
        location: '第五章',
        description: '时间线略有偏差'
      }
    ],
    summary: '共发现 2 处连续性问题'
  };

  it('合法数据校验通过并返回原值', () => {
    const result = validateOutput('continuity-issues', validPayload);
    expect(result).toEqual({ ok: true, value: validPayload });
  });

  it('severity 非法字面量时校验失败', () => {
    const invalid = {
      issues: [{ id: 'x', severity: 'critical', location: 'l', description: 'd' }],
      summary: 's'
    };
    const result = validateOutput('continuity-issues', invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('/issues/0/severity'))).toBe(true);
    }
  });

  it('缺少必填字段时错误信息带路径', () => {
    const result = validateOutput('continuity-issues', { issues: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some(e => e.includes('summary'))).toBe(true);
    }
  });

  it('多余字段被拒绝', () => {
    const result = validateOutput('continuity-issues', { ...validPayload, extra: true });
    expect(result.ok).toBe(false);
  });

  it('创作检查点要求分离事实、约束与未决事项', () => {
    const checkpoint = {
      objective: '继续写完第三章夜谈场景',
      authorConstraints: ['不得揭露顾沉的真实身份'],
      confirmedFacts: ['林晚左眼已盲'],
      creativeState: ['林晚已经看到旧照片'],
      decisions: ['本场采用林晚限知视角'],
      unresolved: ['照片来源尚未确认'],
      recentProgress: ['完成车间入口段落'],
      nextIntent: ['续写林晚试探顾沉']
    };

    expect(validateOutput('creative-checkpoint', checkpoint)).toEqual({ ok: true, value: checkpoint });
    expect(validateOutput('creative-checkpoint', { ...checkpoint, confirmedFacts: ['事实'], extra: true }).ok).toBe(
      false
    );
  });

  it('未注册 schema id 归入失败分支', () => {
    const result = validateOutput('no-such-schema', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain('no-such-schema');
    }
  });
});
