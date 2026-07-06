export function blankToUndefined(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function stripTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '');
}
