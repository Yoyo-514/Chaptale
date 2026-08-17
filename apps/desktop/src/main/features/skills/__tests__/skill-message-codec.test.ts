import { describe, expect, it } from 'vitest';

import { decodeSkillMessage } from '../message-codec';

describe('skill message codec', () => {
  it('restores compact UI metadata from native expanded skill text', () => {
    const expanded = `<skill name="review" location="C:/skills/review/SKILL.md">\nReferences are relative to C:/skills/review.\n\n先检查人物一致性。\n</skill>\n\n检查第一章`;

    expect(decodeSkillMessage(expanded)).toEqual({
      text: '检查第一章',
      promptPrefix: expanded,
      skillInvocation: {
        name: 'review',
        arguments: '检查第一章'
      }
    });
  });

  it('restores invocations without arguments', () => {
    const expanded = `<skill name="review" location="C:/skills/review/SKILL.md">\nReferences are relative to C:/skills/review.\n\n完整技能说明\n</skill>`;

    expect(decodeSkillMessage(expanded)).toEqual({
      text: '',
      promptPrefix: expanded,
      skillInvocation: { name: 'review', arguments: '' }
    });
  });

  it('leaves ordinary and malformed messages untouched', () => {
    expect(decodeSkillMessage('普通消息')).toEqual({
      text: '普通消息',
      promptPrefix: '',
      skillInvocation: undefined
    });
    expect(decodeSkillMessage('<skill>未闭合')).toEqual({
      text: '<skill>未闭合',
      promptPrefix: '',
      skillInvocation: undefined
    });
  });
});
