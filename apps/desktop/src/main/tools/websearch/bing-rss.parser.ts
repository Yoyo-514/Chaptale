import type { WebsearchResultItem } from './websearch.types';

export function parseBingRssResults(rss: string): WebsearchResultItem[] {
  const matches = rss.match(/<item>([\s\S]*?)<\/item>/g);

  if (!matches) {
    return [];
  }

  const results = matches.map(match => {
    const title = match.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    const link = match.match(/<link>([\s\S]*?)<\/link>/)?.[1];
    const description = match.match(/<description>([\s\S]*?)<\/description>/)?.[1];

    if (!title || !link) {
      return null;
    }

    return { title, link, description };
  });

  return results.filter(result => result !== null);
}
