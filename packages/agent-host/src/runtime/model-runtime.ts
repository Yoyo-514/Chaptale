import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { validateAuthConfig } from './auth-config.ts';

export interface CreateHostModelRuntimeOptions {
  /** 已存在的应用私有配置绝对目录，需可写（SDK 会在其中初始化自有存储）；不得使用作品目录或全局 pi 目录。 */
  configDir: string;
}

/** 不存在、不可读或不是目录时返回 false；不向调用方传播含完整路径的原始 stat 错误。 */
async function isExistingDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** 只装配原生运行时；不选择模型、不迁移设置，也不请求模型或联网刷新目录。 */
export async function createHostModelRuntime({ configDir }: CreateHostModelRuntimeOptions): Promise<ModelRuntime> {
  if (!isAbsolute(configDir) || !(await isExistingDirectory(configDir))) {
    throw new Error('configDir 必须是已存在的绝对目录');
  }

  const authPath = join(configDir, 'auth.json');
  await validateAuthConfig(authPath);
  const runtime = await ModelRuntime.create({
    authPath,
    modelsPath: join(configDir, 'models.json'),
    modelsStorePath: join(configDir, 'models-store.json'),
    allowModelNetwork: false,
    refreshOnCreate: false
  });
  // 原生配置解析/组合错误不一定抛出异常，禁止将其当作可用的降级配置。
  if (runtime.getError()) throw new Error('应用 models.json 加载或模型配置组合失败');

  const result = await runtime.refresh({ allowNetwork: false });
  if (result.aborted || result.errors.size > 0 || runtime.getError()) {
    // SDK 错误可能包含配置值；这里只报告阶段，不回显凭据或原始配置。
    throw new Error('应用模型目录缓存或凭据可用性检查失败');
  }
  // 空可用模型列表是待配置状态，调用方仍可通过原生运行时管理凭据。
  return runtime;
}
