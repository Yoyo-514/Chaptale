import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ContentStore } from '../content-store';
import { WebToolsSettingsStore, normalizeSettings } from '../settings';
import { createWebTools } from '../tools';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function createDeps(fetch: typeof globalThis.fetch, settings = normalizeSettings({})) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'web-tools-'));
  tempDirs.push(dir);
  const configPath = path.join(dir, 'web-tools.json');
  const settingsStore = new WebToolsSettingsStore({ configPath });
  await settingsStore.write(settings);

  return { settingsStore, contentStore: new ContentStore(), fetch };
}

function toolsOf(deps: Awaited<ReturnType<typeof createDeps>>) {
  const [webSearch, fetchContent, getSearchContent] = createWebTools(deps);
  return { webSearch, fetchContent, getSearchContent };
}

const DDG_HTML = `<html><body><div class="result">
<h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">结果甲</a></h2>
<a class="result__snippet">甲的摘要</a>
</div><div class="result">
<h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fb">结果乙</a></h2>
<a class="result__snippet">乙的摘要</a>
</div></body></html>`;

describe('web_search 工具', () => {
  it('默认 DDG：text 为编号列表，details 为结构化结果', async () => {
    const deps = await createDeps((async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://html.duckduckgo.com/html/');
      return new Response(DDG_HTML, { status: 200 });
    }) as typeof fetch);

    const { webSearch } = toolsOf(deps);
    const result = await webSearch.execute({ query: '测试' });

    expect(result.text).toContain('1. 结果甲 — https://example.com/a');
    expect(result.text).toContain('甲的摘要');
    expect(result.details).toEqual({
      results: [
        { title: '结果甲', url: 'https://example.com/a', snippet: '甲的摘要' },
        { title: '结果乙', url: 'https://example.org/b', snippet: '乙的摘要' }
      ]
    });
  });

  it('零结果返回友好提示', async () => {
    const deps = await createDeps(async () => new Response('<html></html>', { status: 200 }));
    const { webSearch } = toolsOf(deps);

    const result = await webSearch.execute({ query: '无结果' });

    expect(result.text).toContain('没有找到相关结果');
    expect(result.details).toEqual({ results: [] });
  });

  it('brave 未配 key 时报错提示改用 duckduckgo', async () => {
    const deps = await createDeps(async () => new Response('{}', { status: 200 }), {
      ...normalizeSettings({}),
      search: { enabled: true, provider: 'brave' }
    });
    const { webSearch } = toolsOf(deps);

    await expect(webSearch.execute({ query: 'x' })).rejects.toThrow(/Brave API key/);
  });

  it('provider 请求失败上抛 HTTP 错误', async () => {
    const deps = await createDeps(async () => new Response('nope', { status: 503 }));
    const { webSearch } = toolsOf(deps);

    await expect(webSearch.execute({ query: 'x' })).rejects.toThrow(/HTTP 503/);
  });
});

describe('fetch_content 工具', () => {
  it('HTML 提取为 markdown，text 带 # 标题，details 结构化并写入缓存', async () => {
    const deps = await createDeps(
      async () =>
        new Response(
          '<html><head><title>标题甲</title></head><body><article><h1>标题甲</h1><p>正文内容段落。</p></article></body></html>',
          { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
        )
    );
    const { fetchContent, getSearchContent } = toolsOf(deps);

    const result = await fetchContent.execute({ url: 'https://example.com/page' });

    expect(result.text.startsWith('# 标题甲')).toBe(true);
    expect(result.text).toContain('正文内容段落');
    expect(result.details).toMatchObject({
      url: 'https://example.com/page',
      title: '标题甲',
      truncated: false,
      wordCount: expect.any(Number)
    });

    // 缓存已写入，get_search_content 可检索到。
    const cached = await getSearchContent.execute({ query: '正文内容' });
    expect(cached.details).toMatchObject({ matches: [expect.objectContaining({ url: 'https://example.com/page' })] });
  });

  it('重定向到内网地址被 SSRF 拒绝', async () => {
    const deps = await createDeps(
      async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } })
    );
    const { fetchContent } = toolsOf(deps);

    await expect(fetchContent.execute({ url: 'https://example.com/redirect' })).rejects.toThrow(/内网或保留地址/);
  });

  it('JSON 内容原样返回（raw 模式）', async () => {
    const json = '{"data":[1,2,3]}';
    const deps = await createDeps(
      async () => new Response(json, { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const { fetchContent } = toolsOf(deps);

    const result = await fetchContent.execute({ url: 'https://example.com/api', mode: 'raw' });

    expect(result.text).toContain(json);
  });

  it('非白名单 Content-Type 拒绝', async () => {
    const deps = await createDeps(
      async () => new Response('binary', { status: 200, headers: { 'content-type': 'application/octet-stream' } })
    );
    const { fetchContent } = toolsOf(deps);

    await expect(fetchContent.execute({ url: 'https://example.com/file' })).rejects.toThrow(/Content-Type/);
  });
});

describe('get_search_content 工具', () => {
  it('缓存未命中返回引导提示', async () => {
    const deps = await createDeps(async () => new Response('{}'));
    const { getSearchContent } = toolsOf(deps);

    const result = await getSearchContent.execute({ query: '任意' });

    expect(result.text).toContain('没有匹配内容');
    expect(result.details).toEqual({ matches: [] });
  });

  it('指定 url 查找 findText 命中段落', async () => {
    const deps = await createDeps(async () => new Response('{}'));
    deps.contentStore.put({
      url: 'https://example.com/x',
      title: '页面',
      text: '前文。目标词出现在这里。后文。',
      wordCount: 10,
      fetchedAt: Date.now()
    });
    const { getSearchContent } = toolsOf(deps);

    const result = await getSearchContent.execute({ url: 'https://example.com/x', findText: '目标词' });

    expect(result.text).toContain('目标词');
    expect(result.details).toMatchObject({ matches: [expect.objectContaining({ url: 'https://example.com/x' })] });
  });
});
