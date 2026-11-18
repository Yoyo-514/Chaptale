import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { EmbeddingSettingsSave, EmbeddingSettingsView } from '../protocol/index.ts';
import { httpUrl } from '../runtime/model-configuration.ts';
import type { EmbeddingConnection } from './embeddings.ts';

function view({ apiKey, ...settings }: EmbeddingConnection): EmbeddingSettingsView {
  return { ...settings, hasApiKey: apiKey !== undefined };
}

/** 校验表单里的设置；没有填密钥时沿用已保存的 savedKey。 */
function connectionOf(
  { baseUrl, model, dimensions, apiKey }: EmbeddingSettingsSave,
  savedKey: string | undefined
): EmbeddingConnection {
  httpUrl(baseUrl);
  if (!model.trim()) throw new Error('模型名不能为空');
  if (dimensions !== null && !(Number.isInteger(dimensions) && dimensions > 0)) throw new Error('向量维度必须为正整数');
  if (apiKey !== undefined && !apiKey.trim()) throw new Error('API 密钥必须为非空凭据文本');
  const key = apiKey ?? savedKey;
  return { baseUrl: baseUrl.trim(), model: model.trim(), dimensions, ...(key !== undefined && { apiKey: key }) };
}

/** 检索服务设置保存在应用配置目录的 embedding.json，和模型配置一样留在本机。 */
export class EmbeddingConfiguration {
  private queue: Promise<unknown> = Promise.resolve();

  private readonly file: string;

  constructor(directory: string) {
    this.file = join(directory, 'embedding.json');
  }

  /** 已保存的连接，含密钥；还没有设置时为 null。 */
  async connection(): Promise<EmbeddingConnection | null> {
    await this.queue;
    return this.read();
  }

  async view(): Promise<EmbeddingSettingsView | null> {
    const connection = await this.connection();
    return connection && view(connection);
  }

  /** 表单里的设置对应的连接，用于保存前测试。 */
  async resolve(input: EmbeddingSettingsSave): Promise<EmbeddingConnection> {
    return connectionOf(input, (await this.connection())?.apiKey);
  }

  save(input: EmbeddingSettingsSave): Promise<EmbeddingSettingsView> {
    const operation = this.queue.then(async () => {
      const connection = connectionOf(input, (await this.read())?.apiKey);
      const temporary = this.file + '.tmp';
      await writeFile(temporary, JSON.stringify(connection, null, 2) + '\n');
      await rename(temporary, this.file);
      return view(connection);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private async read(): Promise<EmbeddingConnection | null> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as EmbeddingConnection;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return null;
    }
  }
}
