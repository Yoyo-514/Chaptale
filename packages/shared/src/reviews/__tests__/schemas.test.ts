import { describe, expect, it } from 'vitest';

import {
  CharacterIssuesSchema,
  ContinuityIssuesSchema,
  StyleIssuesSchema,
  decodeReviewIssues,
  validateOutput
} from '@chaptale/shared';

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
} as const;

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
} as const;

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
} as const;

describe('review schemas', () => {
  it('导出三个 reviewer schema', () => {
    expect(ContinuityIssuesSchema).toBeDefined();
    expect(CharacterIssuesSchema).toBeDefined();
    expect(StyleIssuesSchema).toBeDefined();
  });

  it('decodeReviewIssues 返回 continuity v1 结果', () => {
    expect(decodeReviewIssues('continuity', continuityPayload)).toEqual(continuityPayload);
  });

  it('decodeReviewIssues 返回 character v1 结果', () => {
    expect(decodeReviewIssues('character', characterPayload)).toEqual(characterPayload);
  });

  it('decodeReviewIssues 返回 style v1 结果', () => {
    expect(decodeReviewIssues('style', stylePayload)).toEqual(stylePayload);
  });

  it('validateOutput 接受三个 reviewer 的 v1 payload', () => {
    expect(validateOutput('continuity-issues', continuityPayload).ok).toBe(true);
    expect(validateOutput('character-issues', characterPayload).ok).toBe(true);
    expect(validateOutput('style-issues', stylePayload).ok).toBe(true);
  });

  it('拒绝空 summary', () => {
    const cases = [
      ['continuity-issues', continuityPayload],
      ['character-issues', characterPayload],
      ['style-issues', stylePayload]
    ] as const;

    for (const [schemaId, payload] of cases) {
      expect(validateOutput(schemaId, { ...payload, summary: '' }).ok).toBe(false);
    }
  });

  it('拒绝旧 continuity payload', () => {
    const legacyPayload = {
      issues: [{ id: 'old', severity: 'high', location: '第三章', description: '旧格式' }],
      summary: '旧格式'
    };

    expect(decodeReviewIssues('continuity', legacyPayload)).toBeUndefined();
    expect(validateOutput('continuity-issues', legacyPayload).ok).toBe(false);
  });

  it('表驱动拒绝三类专属字段互斥的负例', () => {
    const cases = [
      {
        schemaId: 'continuity-issues',
        payload: {
          ...continuityPayload,
          issues: [{ ...continuityPayload.issues[0], expectedBehavior: '角色应保持一致的时间线行为。' }]
        }
      },
      {
        schemaId: 'continuity-issues',
        payload: {
          ...continuityPayload,
          issues: [{ ...continuityPayload.issues[0], characterId: 'hero' }]
        }
      },
      {
        schemaId: 'continuity-issues',
        payload: {
          ...continuityPayload,
          issues: [{ ...continuityPayload.issues[0], rewriteSuggestion: '把时间点改成第一天。' }]
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
          issues: [{ ...stylePayload.issues[0], expectedBehavior: '应保持克制叙述。' }]
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

  it('拒绝空 quote、reason 与 suggestion', () => {
    expect(
      validateOutput('continuity-issues', {
        ...continuityPayload,
        issues: [{ ...continuityPayload.issues[0], quote: '' }]
      }).ok
    ).toBe(false);
    expect(
      validateOutput('continuity-issues', {
        ...continuityPayload,
        issues: [{ ...continuityPayload.issues[0], reason: '' }]
      }).ok
    ).toBe(false);
    expect(
      validateOutput('continuity-issues', {
        ...continuityPayload,
        issues: [{ ...continuityPayload.issues[0], suggestion: '' }]
      }).ok
    ).toBe(false);
  });

  it('拒绝负 position', () => {
    expect(
      validateOutput('continuity-issues', {
        ...continuityPayload,
        issues: [{ ...continuityPayload.issues[0], position: { start: -1, end: 26 } }]
      }).ok
    ).toBe(false);
    expect(
      validateOutput('continuity-issues', {
        ...continuityPayload,
        issues: [{ ...continuityPayload.issues[0], position: { start: 12, end: -1 } }]
      }).ok
    ).toBe(false);
  });

  it('拒绝额外字段', () => {
    expect(
      validateOutput('continuity-issues', {
        ...continuityPayload,
        issues: [{ ...continuityPayload.issues[0], extra: true }]
      }).ok
    ).toBe(false);
  });

  it('拒绝错误 agentType', () => {
    expect(
      validateOutput('character-issues', {
        ...characterPayload,
        issues: [{ ...characterPayload.issues[0], agentType: 'style' }]
      }).ok
    ).toBe(false);
  });

  it('character issue 缺少 expectedBehavior 时失败', () => {
    const issue = Object.fromEntries(
      Object.entries(characterPayload.issues[0]).filter(([key]) => key !== 'expectedBehavior')
    );

    expect(
      validateOutput('character-issues', {
        ...characterPayload,
        issues: [issue]
      }).ok
    ).toBe(false);
  });
});
