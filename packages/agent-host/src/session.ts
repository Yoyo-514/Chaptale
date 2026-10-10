import {
  createAgentSession,
  type CreateAgentSessionResult,
  DefaultResourceLoader,
  type ModelRuntime,
  type SessionManager,
  SettingsManager
} from '@earendil-works/pi-coding-agent';
import { stat } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';

import { bindHostTools, type HostToolAccess } from './tool-access.ts';

export interface CreateHostSessionOptions {
  /** 已存在的工作目录；不是文件或命令沙箱。 */
  cwd: string;
  /** 应用管理的 pi 资源目录，不使用开发机全局目录。 */
  agentDir: string;
  /** 由创作模块提供提示词，宿主不内置章节工作流。 */
  systemPrompt: string | (() => string);
  /** 调用方装配模型与凭据；此处不发现或加载 auth.json / models.json。 */
  modelRuntime: ModelRuntime;
  /** 显式选择运行时已注册的聊天模型；不接受 URL、headers 或凭据覆写。 */
  model?: { provider: string; id: string };
  /** 调用方拥有存储位置与单写者生命周期，直接使用 pi 原生会话。 */
  sessionManager: SessionManager;
  /** 显式工具集合与逐次授权；省略时没有可执行工具。 */
  toolAccess?: HostToolAccess;
}

/**
 * 创建应用持有的 SDK 会话，不启动 CLI 或 UI。
 * 工具仅来自显式注册并经过应用授权，不自动发现目录中的资源。
 * 返回原生 SDK 结果；调用方负责停止活跃运行并释放 session。
 */
export async function createHostSession(options: CreateHostSessionOptions): Promise<CreateAgentSessionResult> {
  const { cwd, agentDir, systemPrompt, modelRuntime, sessionManager } = options;
  for (const [name, directory] of [
    ['cwd', cwd],
    ['agentDir', agentDir]
  ] as const) {
    if (!isAbsolute(directory) || !(await stat(directory)).isDirectory()) {
      throw new Error(`${name} 必须是已存在的绝对目录`);
    }
  }
  if (!isAbsolute(sessionManager.getCwd()) || relative(cwd, sessionManager.getCwd()) !== '') {
    throw new Error('会话工作目录与宿主工作目录不一致');
  }
  const resolveSystemPrompt = () => (typeof systemPrompt === 'string' ? systemPrompt : systemPrompt());
  if (!resolveSystemPrompt().trim()) {
    throw new Error('必须显式提供非空系统提示词');
  }

  const model = options.model ? modelRuntime.getModel(options.model.provider, options.model.id) : undefined;
  if (options.model !== undefined && !model) {
    throw new Error('所选模型未在应用模型运行时中注册');
  }

  const bindings = options.toolAccess ? bindHostTools(options.toolAccess) : undefined;
  const settingsManager = SettingsManager.inMemory({ cacheWarming: 'off' });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    // pi 的 systemPrompt 支持文件路径；应用输入始终按文本使用，且不发现追加提示词。
    systemPrompt: '',
    systemPromptOverride: resolveSystemPrompt,
    appendSystemPrompt: [],
    noExtensions: true,
    extensionFactories: bindings ? [bindings.guard] : [],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true
  });
  await resourceLoader.reload();
  if (resourceLoader.getExtensions().errors.length > 0) {
    throw new Error('宿主工具授权扩展加载失败');
  }

  return createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model,
    sessionManager,
    settingsManager,
    resourceLoader,
    tools: bindings?.names ?? [],
    customTools: bindings?.tools
  });
}
