import type { SkillInvocation } from '@chaptale/shared';

const SKILL_ENVELOPE_PATTERN = /^<skill\b([^>]*)>\r?\n[\s\S]*?\r?\n<\/skill>(?:\r?\n\r?\n([\s\S]*))?\r?\n?$/;
const ATTRIBUTE_PATTERN = /([\w:-]+)="([^"]*)"/g;

function decodeXmlAttribute(value: string) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function parseAttributes(source: string) {
  const attributes: Record<string, string> = {};

  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    attributes[match[1]!] = decodeXmlAttribute(match[2]!);
  }

  return attributes;
}

/** 从 pi 原生 skill 展开文本中恢复紧凑的 UI 调用信息。 */
export function decodeSkillMessage(text: string) {
  const envelope = SKILL_ENVELOPE_PATTERN.exec(text);

  if (!envelope) {
    return { text, promptPrefix: '', skillInvocation: undefined };
  }

  const name = parseAttributes(envelope[1]!).name;

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
