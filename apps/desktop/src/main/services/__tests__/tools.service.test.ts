import { afterEach, describe, expect, it, vi } from 'vitest';

import { websearch } from '../tools.service';

describe('websearch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses Bing RSS search results', async () => {
    const rss = `
      <rss>
        <channel>
          <item>
            <title>Chaptale</title>
            <link>https://example.com/chaptale</link>
            <description>Creative writing IDE</description>
          </item>
          <item>
            <title>Missing link should be ignored</title>
          </item>
        </channel>
      </rss>
    `;

    const fetchMock = vi.fn(async () => {
      return {
        text: async () => rss
      } as Response;
    });

    vi.stubGlobal('fetch', fetchMock);

    const results = await websearch({ keywords: 'Chaptale' });

    expect(fetchMock).toHaveBeenCalledWith('https://www.bing.com/search?format=rss&q=Chaptale', undefined);
    expect(results).toEqual([
      {
        title: 'Chaptale',
        link: 'https://example.com/chaptale',
        description: 'Creative writing IDE'
      }
    ]);
  });

  it('returns an empty list when RSS has no item', async () => {
    vi.stubGlobal('fetch', async () => {
      return {
        text: async () => '<rss><channel /></rss>'
      } as Response;
    });

    await expect(websearch({ keywords: 'empty' })).resolves.toEqual([]);
  });
});
