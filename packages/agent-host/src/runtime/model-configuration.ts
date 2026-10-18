import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DiscoveredModel, ModelDiscovery, NativeProvider, ProviderSave, ProviderView } from '../protocol.ts';

type StoredProvider = NativeProvider & { apiKey?: string };
type NativeModels = { providers: Record<string, StoredProvider>; [field: string]: unknown };

function httpUrl(value: string): URL {
  const url = URL.parse(value);
  if (url?.protocol !== 'http:' && url?.protocol !== 'https:')
    throw new Error('服务地址必须为有效的 HTTP 或 HTTPS 地址');
  return url;
}

/** 设置界面直接编辑 pi 原生 models.json；写入后由运行时重新加载，失败时恢复原文件。 */
export class HostModelConfiguration {
  private queue: Promise<unknown> = Promise.resolve();

  private readonly file: string;
  private readonly runtime: ModelRuntime;

  constructor(directory: string, runtime: ModelRuntime) {
    this.file = join(directory, 'models.json');
    this.runtime = runtime;
  }

  async list(): Promise<ProviderView[]> {
    await this.queue;
    const { config } = await this.read();
    return Object.entries(config.providers).map(([id, { apiKey, ...provider }]) => ({
      id,
      config: provider,
      hasApiKey: apiKey !== undefined
    }));
  }

  async save({ id, config, apiKey }: ProviderSave): Promise<void> {
    if (!id.trim()) throw new Error('供应商标识不能为空');
    if ('apiKey' in config) throw new Error('API 密钥请在密钥栏填写');
    if (config.baseUrl !== undefined) httpUrl(config.baseUrl);
    if (apiKey !== undefined && (!apiKey.trim() || apiKey.startsWith('!')))
      throw new Error('API 密钥必须为非空凭据文本');
    return this.update(native => {
      const stored = apiKey ?? native.providers[id]?.apiKey;
      native.providers[id] = stored === undefined ? config : { ...config, apiKey: stored };
    });
  }

  remove(id: string): Promise<void> {
    return this.update(native => {
      delete native.providers[id];
    });
  }

  async discover({ id, baseUrl, api, headers, apiKey }: ModelDiscovery): Promise<DiscoveredModel[]> {
    if (api === 'anthropic-messages') throw new Error('该接口类型没有通用的模型列表接口');
    const key = apiKey ?? (id ? (await this.runtime.getAuth(id))?.auth.apiKey : undefined);
    const url = httpUrl(`${baseUrl.replace(/\/+$/, '')}/models`);
    const request: Record<string, string> = { Accept: 'application/json', ...headers };
    if (key && api === 'google-generative-ai') request['x-goog-api-key'] = key;
    else if (key) request.Authorization = `Bearer ${key}`;
    const response = await fetch(url, { headers: request });
    if (!response.ok) throw new Error(`模型列表请求失败：HTTP ${response.status}`);
    const body = (await response.json()) as { data?: unknown; models?: unknown };
    const items = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
    return items.flatMap((item: { id?: unknown; name?: unknown; displayName?: unknown }) => {
      const raw = typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : '';
      // Google 的模型资源名带 models/ 前缀，请求时使用去掉前缀的 ID。
      const modelId = raw.replace(/^models\//, '');
      if (!modelId) return [];
      const label = typeof item.displayName === 'string' ? item.displayName : modelId;
      return [{ id: modelId, name: label }];
    });
  }

  private async read(): Promise<{ text?: string; config: NativeModels }> {
    try {
      const text = await readFile(this.file, 'utf8');
      return { text, config: JSON.parse(text) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { config: { providers: {} } };
    }
  }

  private update(change: (config: NativeModels) => void): Promise<void> {
    const operation = this.queue.then(async () => {
      const { text, config } = await this.read();
      change(config);
      await this.replace(JSON.stringify(config, null, 2) + '\n');
      const result = await this.runtime.refresh({ allowNetwork: false });
      const error = this.runtime.getError();
      if (!result.aborted && !result.errors.size && !error) return;
      await this.replace(text ?? '{\n  "providers": {}\n}\n');
      await this.runtime.refresh({ allowNetwork: false });
      throw new Error(error ? `模型配置无效，已恢复原配置：${error}` : '模型配置无法装配，已恢复原配置');
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private async replace(text: string): Promise<void> {
    const temporary = this.file + '.tmp';
    await writeFile(temporary, text);
    await rename(temporary, this.file);
  }
}
