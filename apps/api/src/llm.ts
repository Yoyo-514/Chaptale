import { ChatOpenAI } from '@langchain/openai';

// 抑制 token 计算相关的警告日志
// 因为 token 计算失败不影响核心功能，会自动回退到近似计数
const originalConsoleWarn = console.warn;
console.warn = (...args: any[]) => {
  const message = args[0]?.toString() || '';
  // 过滤掉 token 计算失败的警告
  if (
    message.includes('Failed to calculate number of tokens') ||
    message.includes('falling back to approximate count')
  ) {
    return;
  }
  originalConsoleWarn.apply(console, args);
};

// 调用大模型 API 必要参数
const API_KEY = process.env.API_KEY;
const BASE_URL = process.env.BASE_URL;
const MODEL = process.env.MODEL;

if (!API_KEY || !BASE_URL || !MODEL) {
  throw new Error('请在 .env 中设置 API_KEY、BASE_URL 和 MODEL 值');
}

// 创建 LangChain 模型实例
export const llm = new ChatOpenAI({
  model: MODEL,
  configuration: {
    baseURL: BASE_URL,
    apiKey: API_KEY,
    // 添加浏览器请求头以绕过 Cloudflare 的机器人检测
    // 模拟真实浏览器请求，避免被识别为程序化请求而被阻止
    defaultHeaders: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache'
    },
    timeout: 60000
  },
  streaming: true,
  // 禁用自动 token 计数以避免额外的 API 调用
  // 这样可以减少网络请求，避免 ECONNRESET 错误
  cache: false,
  maxRetries: 3,
  timeout: 60000
});
