import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getModelKey } from './config-helpers';
import type { PiModelsConfig } from './config-types';

export type PiModelConfigRepositoryOptions = {
  modelsPath: string;
  onWrite?: () => void | Promise<void>;
};

/**
 * models.json 的持久化边界。
 *
 * 所有 read-modify-write 变更在进程内串行执行，并通过同目录临时文件 rename 替换目标，
 * 避免并发设置请求互相覆盖或让读取方看到写入一半的 JSON。
 */
export class PiModelConfigRepository {
  private mutationQueue = Promise.resolve();

  constructor(private readonly options: PiModelConfigRepositoryOptions) {}

  async read(): Promise<PiModelsConfig> {
    return this.readImmediately();
  }

  write(config: PiModelsConfig): Promise<void> {
    return this.enqueueMutation(() => this.writeImmediately(config));
  }

  /** 在同一个写队列中完成读取、变更与落盘，保证 mutator 基于最新配置执行。 */
  update(mutator: (config: PiModelsConfig) => void | Promise<void>): Promise<void> {
    return this.enqueueMutation(async () => {
      const config = await this.readImmediately();
      await mutator(config);
      await this.writeImmediately(config);
    });
  }

  /**
   * 返回显式写入 models.json 的模型键；读取失败时降级为空集合，
   * 使模型列表仍可展示 pi 内置模型，具体配置错误留给编辑操作报告。
   */
  async getCustomModelKeys() {
    try {
      const config = await this.read();
      return new Set(
        Object.entries(config.providers).flatMap(([provider, providerConfig]) =>
          (providerConfig.models ?? []).map(model => getModelKey(provider, model.id))
        )
      );
    } catch {
      return new Set<string>();
    }
  }

  findCustomModel(config: PiModelsConfig, provider: string, modelId: string) {
    const providerConfig = config.providers[provider];

    if (!providerConfig?.models?.length) {
      throw new Error(`未找到自定义供应商：${provider}`);
    }

    const model = providerConfig.models.find(item => item.id === modelId);

    if (!model) {
      throw new Error(`未找到自定义模型：${provider}/${modelId}`);
    }

    return model;
  }

  private async readImmediately(): Promise<PiModelsConfig> {
    try {
      const content = await readFile(this.options.modelsPath, 'utf8');
      const parsed = JSON.parse(stripJsonComments(content)) as unknown;

      if (!parsed || typeof parsed !== 'object' || !('providers' in parsed)) {
        throw new Error('models.json 必须包含 providers 对象');
      }

      const config = parsed as PiModelsConfig;
      if (!config.providers || typeof config.providers !== 'object' || Array.isArray(config.providers)) {
        throw new Error('models.json 的 providers 必须是对象');
      }

      return config;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return { providers: {} };
      }

      throw error;
    }
  }

  private async writeImmediately(config: PiModelsConfig): Promise<void> {
    const directory = path.dirname(this.options.modelsPath);
    const tempPath = path.join(
      directory,
      `.${path.basename(this.options.modelsPath)}.${process.pid}.${randomUUID()}.tmp`
    );

    await mkdir(directory, { recursive: true });

    try {
      await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await rename(tempPath, this.options.modelsPath);
      await this.options.onWrite?.();
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  /** 单次写入失败不污染队列状态，后续配置修改仍可继续尝试。 */
  private enqueueMutation(operation: () => Promise<void>): Promise<void> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.catch(() => undefined);
    return result;
  }
}

function stripJsonComments(content: string) {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
