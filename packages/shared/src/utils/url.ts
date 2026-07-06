export function cleanUrlToken(url: string) {
  return url.replace(/[),.;]+$/, '');
}

export function getHostname(link: string) {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return link;
  }
}
