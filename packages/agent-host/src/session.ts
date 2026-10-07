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

export interface CreateHostSessionOptions {
  /** 已存在的工作目录；不是文件或命令沙箱。 */
  cwd: string;
  /** 应用管理的 pi 资源目录，不使用开发机全局目录。 */
  agentDir: string;
  /** 由创作模块提供提示词，宿主不内置章节工作流。 */
  systemPrompt: string;
  /** 调用方装配模型与凭据；此处不发现或加载 auth.json / models.json。 */
  modelRuntime: ModelRuntime;
  /** 调用方拥有存储位置与单写者生命周期，直接使用 pi 原生会话。 */
  sessionManager: SessionManager;
}

/**
 * 创建应用持有的 SDK 会话，不启动 CLI 或 UI。
 * 本步尚未接入权限及工具装配，因此不启用工具或自动发现资源。
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
  if (!systemPrompt.trim()) {
    throw new Error('必须显式提供非空系统提示词');
  }

  const settingsManager = SettingsManager.inMemory({ cacheWarming: 'off' });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    // pi 的 systemPrompt 支持文件路径；应用输入始终按文本使用，且不发现追加提示词。
    systemPrompt: '',
    systemPromptOverride: () => systemPrompt,
    appendSystemPrompt: [],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true
  });
  await resourceLoader.reload();

  return createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    sessionManager,
    settingsManager,
    resourceLoader,
    tools: []
  });
}
