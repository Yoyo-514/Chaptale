import type { ReviewIssue } from './schemas';

export type ReviewAnchor =
  | {
      stale: false;
      start: number;
      end: number;
      strategy: 'exact' | 'nearest' | 'normalized';
    }
  | {
      stale: true;
      reason: 'ambiguous' | 'not-found';
    };

type ReviewPosition = NonNullable<ReviewIssue['position']>;
type TextSpan = {
  start: number;
  end: number;
};
type NormalizedChar = TextSpan & {
  char: string;
};

const PUNCTUATION_EQUIVALENTS = new Map<string, string>([
  ['，', ','],
  [',', ','],
  ['。', '.'],
  ['.', '.'],
  ['!', '!'],
  ['！', '!'],
  ['?', '?'],
  ['？', '?'],
  [':', ':'],
  ['：', ':'],
  [';', ';'],
  ['；', ';'],
  ['“', '"'],
  ['”', '"'],
  ['"', '"'],
  ['‘', "'"],
  ['’', "'"],
  ["'", "'"]
]);

const OPTIONAL_SPACE_NEIGHBOR_CHARS = new Set([',', '.', '!', '?', ':', ';', '"', "'"]);

export function resolveReviewAnchor(text: string, issue: ReviewIssue): ReviewAnchor {
  const quote = getSafeQuote(issue);
  if (quote.length === 0) {
    return { stale: true, reason: 'not-found' };
  }

  const exactMatches = findAll(text, quote);

  if (exactMatches.length === 1) {
    return toResolvedAnchor(exactMatches[0], 'exact');
  }

  if (exactMatches.length > 1) {
    const nearestMatch = findNearestMatch(exactMatches, issue.position);
    return nearestMatch ? toResolvedAnchor(nearestMatch, 'nearest') : { stale: true, reason: 'ambiguous' };
  }

  const normalizedMatches = findNormalizedMatches(text, quote);
  if (normalizedMatches.length === 1) {
    return toResolvedAnchor(normalizedMatches[0], 'normalized');
  }

  if (normalizedMatches.length > 1) {
    const nearestMatch = findNearestMatch(normalizedMatches, issue.position);
    return nearestMatch ? toResolvedAnchor(nearestMatch, 'normalized') : { stale: true, reason: 'ambiguous' };
  }

  return { stale: true, reason: 'not-found' };
}

function findAll(text: string, quote: string): TextSpan[] {
  if (quote.length === 0) {
    return [];
  }

  const matches: TextSpan[] = [];
  let searchFrom = 0;

  while (searchFrom <= text.length - quote.length) {
    const start = text.indexOf(quote, searchFrom);
    if (start === -1) {
      break;
    }

    matches.push({ start, end: start + quote.length });
    searchFrom = start + 1;
  }

  return matches;
}

function getSafeQuote(issue: ReviewIssue): string {
  return typeof issue?.quote === 'string' ? issue.quote : '';
}

function findNearestMatch(matches: TextSpan[], position: ReviewPosition | undefined): TextSpan | undefined {
  if (!hasValidStart(position)) {
    return undefined;
  }

  let bestMatch: TextSpan | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  let duplicatedBestDistance = false;

  for (const match of matches) {
    const distance = Math.abs(match.start - position.start);

    if (distance < bestDistance) {
      bestMatch = match;
      bestDistance = distance;
      duplicatedBestDistance = false;
      continue;
    }

    if (distance === bestDistance) {
      duplicatedBestDistance = true;
    }
  }

  return duplicatedBestDistance ? undefined : bestMatch;
}

function hasValidStart(position: ReviewPosition | undefined): position is ReviewPosition & { start: number } {
  return typeof position?.start === 'number' && Number.isInteger(position.start) && position.start >= 0;
}

function toResolvedAnchor(match: TextSpan, strategy: 'exact' | 'nearest' | 'normalized'): ReviewAnchor {
  return {
    stale: false,
    start: match.start,
    end: match.end,
    strategy
  };
}

function findNormalizedMatches(text: string, quote: string): TextSpan[] {
  const normalizedText = normalizeForComparison(text);
  const normalizedQuote = normalizeForComparison(quote);

  if (normalizedQuote.length === 0) {
    return [];
  }

  return findAllNormalizedMatches(normalizedText, normalizedQuote).map(match => ({
    start: normalizedText[match.start].start,
    end: normalizedText[match.end - 1].end
  }));
}

function findAllNormalizedMatches(normalizedText: NormalizedChar[], normalizedQuote: NormalizedChar[]): TextSpan[] {
  const matches: TextSpan[] = [];
  const lastStart = normalizedText.length - normalizedQuote.length;

  if (lastStart < 0) {
    return matches;
  }

  for (let start = 0; start <= lastStart; start += 1) {
    let matched = true;

    for (let index = 0; index < normalizedQuote.length; index += 1) {
      if (normalizedText[start + index].char !== normalizedQuote[index].char) {
        matched = false;
        break;
      }
    }

    if (matched) {
      matches.push({ start, end: start + normalizedQuote.length });
    }
  }

  return matches;
}

function normalizeForComparison(text: string): NormalizedChar[] {
  return removeOptionalSpacesAroundRegisteredPunctuation(normalizeWithMap(text));
}

function normalizeWithMap(text: string): NormalizedChar[] {
  const normalizedChars: NormalizedChar[] = [];
  let offset = 0;

  for (const rawChar of text) {
    const start = offset;
    const end = start + rawChar.length;
    offset = end;

    for (const normalizedChar of rawChar.normalize('NFKC')) {
      const mappedChar = mapEquivalentPunctuation(normalizedChar);

      if (isWhitespace(mappedChar)) {
        const previousChar = normalizedChars[normalizedChars.length - 1];
        if (previousChar?.char === ' ') {
          previousChar.end = end;
        } else {
          normalizedChars.push({ char: ' ', start, end });
        }
        continue;
      }

      normalizedChars.push({ char: mappedChar, start, end });
    }
  }

  return normalizedChars;
}

function removeOptionalSpacesAroundRegisteredPunctuation(chars: NormalizedChar[]): NormalizedChar[] {
  return chars.filter((char, index) => {
    if (char.char !== ' ') {
      return true;
    }

    const previous = chars[index - 1];
    const next = chars[index + 1];
    return !isOptionalSpaceNeighbor(previous?.char) && !isOptionalSpaceNeighbor(next?.char);
  });
}

function mapEquivalentPunctuation(char: string): string {
  return PUNCTUATION_EQUIVALENTS.get(char) ?? char;
}

function isWhitespace(char: string): boolean {
  return /\s/u.test(char);
}

function isOptionalSpaceNeighbor(char: string | undefined): boolean {
  return char !== undefined && OPTIONAL_SPACE_NEIGHBOR_CHARS.has(char);
}
