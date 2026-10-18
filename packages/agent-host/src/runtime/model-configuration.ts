import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ProviderInput, ProviderSummary } from '../protocol.ts';

type ProviderConfig = Parameters<ModelRuntime['registerProvider']>[1];
type NativeModels = { providers: Record<string, ProviderConfig> };

/** 设置界面直接编辑 pi 原生 models.json；保留其他供应商和高级字段。 */
export class HostModelConfiguration {
  private queue: Promise<unknown> = Promise.resolve();

  private readonly directory: string;
  private readonly runtime: ModelRuntime;

  constructor(directory: string, runtime: ModelRuntime) {
    this.directory = directory;
    this.runtime = runtime;
  }

  save(input: ProviderInput): Promise<void> {
    const operation = this.queue.then(() => this.write(input));
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async list(): Promise<ProviderSummary[]> {
    await this.queue;
    const config = await this.read();
    return Object.entries(config.providers).flatMap(([provider, value]) =>
      (value.models ?? []).map(({ id }) => {
        const model = this.runtime.getModel(provider, id)!;
        return {
          provider,
          baseUrl: model.baseUrl,
          api: model.api,
          modelId: model.id,
          modelName: model.name,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          reasoning: model.reasoning
        };
      })
    );
  }

  private async read(): Promise<NativeModels> {
    try {
      return JSON.parse(await readFile(join(this.directory, 'models.json'), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { providers: {} };
    }
  }

  private async write(input: ProviderInput): Promise<void> {
    let address: URL;
    try {
      address = new URL(input.baseUrl);
    } catch {
      throw new Error('模型地址必须为有效的 HTTP 或 HTTPS 地址');
    }
    if (!['http:', 'https:'].includes(address.protocol)) throw new Error('模型地址必须为有效的 HTTP 或 HTTPS 地址');
    if (!input.provider.trim() || !input.modelId.trim() || !input.modelName.trim())
      throw new Error('供应商、模型 ID 与名称不能为空');
    if (
      !Number.isSafeInteger(input.contextWindow) ||
      input.contextWindow <= 0 ||
      !Number.isSafeInteger(input.maxTokens) ||
      input.maxTokens <= 0 ||
      input.maxTokens > input.contextWindow
    )
      throw new Error('上下文和输出 token 数必须为正整数，输出不能超过上下文');
    if (input.apiKey !== undefined && (!input.apiKey.trim() || input.apiKey.startsWith('!')))
      throw new Error('API key 必须为非空凭据文本');

    const file = join(this.directory, 'models.json');
    const config = await this.read();
    const previous = config.providers[input.provider];
    const model = {
      id: input.modelId,
      name: input.modelName,
      reasoning: input.reasoning,
      input: ['text' as const],
      contextWindow: input.contextWindow,
      maxTokens: input.maxTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    };
    const provider: ProviderConfig = {
      ...previous,
      baseUrl: input.baseUrl,
      api: input.api,
      ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
      models: [...(previous?.models ?? []).filter(value => value.id !== model.id), model]
    };
    config.providers[input.provider] = provider;
    const temporary = file + '.tmp';
    await writeFile(temporary, JSON.stringify(config, null, 2) + '\n');
    await rename(temporary, file);
    this.runtime.registerProvider(input.provider, provider);
    const refreshed = await this.runtime.refresh({ allowNetwork: false });
    if (refreshed.aborted || refreshed.errors.size || this.runtime.getError())
      throw new Error('模型配置已保存，运行时装配失败，请检查原生模型配置');
  }
}
