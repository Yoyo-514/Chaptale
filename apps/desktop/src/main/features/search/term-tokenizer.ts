export interface TermTokenizer {
  /** ID 属于缓存格式的一部分；分词行为变化时必须升级 ID。 */
  readonly id: string;
  tokenize(text: string): string[];
}

export function normalizeSearchText(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ');
}

export class IntlSegmenterTermTokenizer implements TermTokenizer {
  readonly id = 'intl-bigram-v1';
  private readonly segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });

  tokenize(text: string): string[] {
    const normalized = normalizeSearchText(text);
    const terms = new Set<string>();

    for (const segment of this.segmenter.segment(normalized)) {
      if (segment.isWordLike) addTerm(terms, segment.segment);
    }
    addFallbackTerms(terms, normalized);
    return [...terms];
  }
}

/** 双字词不依赖通用词典，可兜住虚构人名、地名等 OOV 专名的基础召回。 */
export function addFallbackTerms(terms: Set<string>, normalizedText: string): void {
  for (const match of normalizedText.matchAll(/[a-z0-9]+/gu)) addTerm(terms, match[0]);
  for (const match of normalizedText.matchAll(/\p{Script=Han}+/gu)) {
    const run = [...match[0]];
    if (run.length === 1) addTerm(terms, run[0]);
    for (let index = 0; index < run.length - 1; index += 1) addTerm(terms, `${run[index]}${run[index + 1]}`);
  }
}

export function addTerm(terms: Set<string>, value: string): void {
  const normalized = normalizeSearchText(value);
  if (normalized && /[\p{Letter}\p{Number}]/u.test(normalized)) terms.add(normalized);
}
