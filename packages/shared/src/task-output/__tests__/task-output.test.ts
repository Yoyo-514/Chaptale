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

  it('三个 reviewer schema 默认已注册', () => {
    expect(getOutputSchema('continuity-issues')).toBeDefined();
    expect(getOutputSchema('character-issues')).toBeDefined();
    expect(getOutputSchema('style-issues')).toBeDefined();
  });

  it('内置 creative-checkpoint schema 默认已注册', () => {
    expect(getOutputSchema('creative-checkpoint')).toBeDefined();
  });
});

describe('validateOutput', () => {
  const continuityPayload = {
    issues: [
      {
        agentType: 'continuity',
        severity: 'high',
        type: 'timeline',
        quote: '第三天，他第一次来到这里。',
        reason: '前文已说明角色第一天到达。',
        suggestion: '统一抵达时间。',
        position: { start: 12, end: 26 }
      }
    ],
    summary: '发现一处时间线冲突。'
  };

  const characterPayload = {
    issues: [
      {
        agentType: 'character',
        severity: 'medium',
        characterId: 'hero',
        type: 'weak_motivation',
        quote: '他决定立刻离开。',
        reason: '前文尚未建立离开的动机。',
        suggestion: '补足离开的触发事件。',
        expectedBehavior: '角色应先表现犹豫，再因线索推动离开。',
        position: { start: 5, end: 13 }
      }
    ],
    summary: '发现一处人物动机问题。'
  };

  const stylePayload = {
    issues: [
      {
        agentType: 'style',
        severity: 'low',
        type: 'over_explaining',
        quote: '她非常非常伤心，因为她的心情非常不好。',
        reason: '解释性重复过多，削弱情绪力度。',
        suggestion: '压缩解释，保留更直接的情绪呈现。',
        rewriteSuggestion: '她喉间发紧，话到嘴边又咽了回去。',
        position: { start: 20, end: 39 }
      }
    ],
    summary: '发现一处文风拖沓问题。'
  };

  it('合法 reviewer 数据校验通过并返回原值', () => {
    expect(validateOutput('continuity-issues', continuityPayload)).toEqual({ ok: true, value: continuityPayload });
    expect(validateOutput('character-issues', characterPayload)).toEqual({ ok: true, value: characterPayload });
    expect(validateOutput('style-issues', stylePayload)).toEqual({ ok: true, value: stylePayload });
  });

  it('按 schema id 执行对应 reviewer schema', () => {
    const cases = [
      {
        schemaId: 'continuity-issues',
        payload: {
          ...continuityPayload,
          issues: [{ ...continuityPayload.issues[0], expectedBehavior: '角色应保持一致的时间线行为。' }]
        }
      },
      {
        schemaId: 'character-issues',
        payload: {
          ...characterPayload,
          issues: [{ ...characterPayload.issues[0], rewriteSuggestion: '他站在门口，迟迟没有迈步。' }]
        }
      },
      {
        schemaId: 'style-issues',
        payload: {
          ...stylePayload,
          issues: [{ ...stylePayload.issues[0], characterId: 'hero' }]
        }
      }
    ] as const;

    for (const { schemaId, payload } of cases) {
      expect(validateOutput(schemaId, payload).ok).toBe(false);
    }
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
