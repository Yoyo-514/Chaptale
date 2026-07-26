import type { PiWebAccessProvider, PiWebAccessSettings, PiWebAccessWorkflow } from '@chaptale/ipc-contract';

export type WebAccessOption<T extends string> = {
  value: T;
  label: string;
  note: string;
};

export const webAccessProviders: WebAccessOption<PiWebAccessProvider>[] = [
  { value: 'auto', label: '自动选择', note: '按当前可用服务自动选择' },
  { value: 'openai', label: 'OpenAI / Codex', note: '可复用 Codex 订阅或 OpenAI Key' },
  { value: 'exa', label: 'Exa', note: '支持自带 Key；也可使用内置零配置路径' },
  { value: 'brave', label: 'Brave', note: '需要 Brave Search API Key' },
  { value: 'parallel', label: 'Parallel', note: '需要 Parallel API Key' },
  { value: 'tavily', label: 'Tavily', note: '需要 Tavily API Key' },
  { value: 'perplexity', label: 'Perplexity', note: '需要 Perplexity API Key' },
  { value: 'gemini', label: 'Gemini', note: '关联搜索模型、视频理解与浏览器 Cookie' }
];

export const webAccessWorkflows: WebAccessOption<PiWebAccessWorkflow>[] = [
  { value: 'none', label: '直接返回', note: '不打开浏览器筛选页，推荐默认' },
  { value: 'auto-summary', label: '自动总结', note: '用模型生成总结，不打开浏览器筛选页' },
  { value: 'summary-review', label: '浏览器筛选', note: '打开临时页面人工筛选来源' }
];

export function createDefaultWebAccessSettings(): PiWebAccessSettings {
  return {
    webSearchEnabled: true,
    provider: 'auto',
    workflow: 'none',
    allowBrowserCookies: false,
    curatorTimeoutSeconds: 20,
    githubClone: {
      enabled: true,
      maxRepoSizeMB: 350,
      cloneTimeoutSeconds: 30
    },
    youtube: {
      enabled: true,
      preferredModel: 'gemini-3-flash-preview'
    },
    video: {
      enabled: true,
      preferredModel: 'gemini-3-flash-preview',
      maxSizeMB: 50
    },
    ssrf: {
      allowRanges: []
    }
  };
}

/**
 * 把后端设置快照补齐为可编辑表单对象；嵌套分组逐层合并，兼容旧配置缺少新增字段的情况。
 */
export function normalizeWebAccessSettings(value: PiWebAccessSettings | undefined): PiWebAccessSettings {
  const fallback = createDefaultWebAccessSettings();
  const source = value ?? fallback;

  return {
    ...fallback,
    ...source,
    githubClone: {
      ...fallback.githubClone,
      ...source.githubClone
    },
    youtube: {
      ...fallback.youtube,
      ...source.youtube
    },
    video: {
      ...fallback.video,
      ...source.video
    },
    ssrf: source.ssrf
      ? {
          ...source.ssrf,
          allowRanges: Array.isArray(source.ssrf.allowRanges) ? source.ssrf.allowRanges : []
        }
      : undefined
  };
}
