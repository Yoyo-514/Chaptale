import { pinyin } from 'pinyin-pro';

import { normalizeSearchText } from './term-tokenizer';

export type PinyinAliasOptions = {
  surnameAtHead?: boolean;
  explicitAliases?: readonly string[];
};

/**
 * 拼音是低权重别名字段，不混入正文词频。单字多音最多保留四项，避免索引组合爆炸。
 */
export function buildPinyinAliases(text: string, options: PinyinAliasOptions = {}): string[] {
  const aliases = new Set<string>();
  const normalizedText = normalizeSearchText(text);
  if (!normalizedText) return [];

  const baseOptions = {
    toneType: 'none' as const,
    type: 'array' as const,
    nonZh: 'removed' as const,
    segmentit: 2 as const,
    ...(options.surnameAtHead ? { mode: 'surname' as const, surname: 'head' as const } : {})
  };

  if ([...normalizedText].length === 1 && /\p{Script=Han}/u.test(normalizedText)) {
    for (const reading of pinyin(normalizedText, { ...baseOptions, multiple: true }).slice(0, 4)) {
      addAlias(aliases, reading);
    }
  } else {
    const syllables = pinyin(normalizedText, baseOptions).filter(Boolean);
    if (syllables.length) {
      addAlias(aliases, syllables.join(' '));
      addAlias(aliases, syllables.join(''));
      addAlias(
        aliases,
        syllables
          .map(syllable => syllable[0])
          .filter(Boolean)
          .join('')
      );
    }
  }

  for (const alias of options.explicitAliases ?? []) addAlias(aliases, alias);
  return [...aliases];
}

function addAlias(aliases: Set<string>, value: string): void {
  const normalized = normalizeSearchText(value);
  if (normalized) aliases.add(normalized);
}
