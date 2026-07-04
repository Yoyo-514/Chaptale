import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getModelKey } from './pi-model-config.helpers';
import type { PiModelsConfig } from './pi-model-config.types';

export type PiModelConfigRepositoryOptions = {
  modelsPath: string;
  onWrite?: () => void;
};

export class PiModelConfigRepository {
  constructor(private readonly options: PiModelConfigRepositoryOptions) {}

  async read(): Promise<PiModelsConfig> {
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

  async write(config: PiModelsConfig) {
    await mkdir(path.dirname(this.options.modelsPath), { recursive: true });
    await writeFile(this.options.modelsPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    this.options.onWrite?.();
  }

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
}

function stripJsonComments(content: string) {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
