const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function isTrustedRendererUrl(candidate: string, trustedEntryUrl: string) {
  try {
    const candidateUrl = new URL(candidate);
    const trustedUrl = new URL(trustedEntryUrl);

    if (trustedUrl.protocol === 'file:') {
      return (
        candidateUrl.protocol === 'file:' &&
        candidateUrl.host === trustedUrl.host &&
        candidateUrl.pathname === trustedUrl.pathname
      );
    }

    return candidateUrl.origin === trustedUrl.origin;
  } catch {
    return false;
  }
}

export function isExternalUrl(candidate: string) {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(candidate).protocol);
  } catch {
    return false;
  }
}
