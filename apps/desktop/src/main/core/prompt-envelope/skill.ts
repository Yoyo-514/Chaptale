import type { SkillInvocation } from '@chaptale/shared';
import { parseXmlAttributes } from '@chaptale/shared';

const SKILL_ENVELOPE_PATTERN = /^<skill\b([^>]*)>\r?\n[\s\S]*?\r?\n<\/skill>(?:\r?\n\r?\n([\s\S]*))?\r?\n?$/;

/** 从 skill 展开文本中恢复紧凑的 UI 调用信息。 */
export function decodeSkillMessage(text: string) {
  const envelope = SKILL_ENVELOPE_PATTERN.exec(text);

  if (!envelope) {
    return { text, promptPrefix: '', skillInvocation: undefined };
  }

  const name = parseXmlAttributes(envelope[1]!).name;

  if (!name) {
    return { text, promptPrefix: '', skillInvocation: undefined };
  }

  const argumentsText = envelope[2]?.trim() ?? '';
  const skillInvocation: SkillInvocation = {
    name,
    arguments: argumentsText
  };

  return {
    text: argumentsText,
    promptPrefix: envelope[0],
    skillInvocation
  };
}
