import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession
} from '@earendil-works/pi-coding-agent';

import { chaptaleSystemPrompt, systemPrompt } from '../prompt';
import type { PiModelService } from '../services/pi-model.service';
import type { SettingsService } from '../services/settings.service';
import { getEnabledToolNames, getPiCustomTools } from '../tools/tool-registry';

export type PiAgentSessionFactoryOptions = {
  settingsService: SettingsService;
  modelService: PiModelService;
};

/**
 * 负责把 Chaptale 会话 ID 解析成 pi AgentSession。
 *
 * 这里集中 pi SDK、ResourceLoader、SessionManager 相关细节，
 * 让 PiAgentService 只关心 runtime 缓存与事件流桥接。
 */
export class PiAgentSessionFactory {
  constructor(private readonly options: PiAgentSessionFactoryOptions) {}

  async create(sessionId: string): Promise<AgentSession> {
    const { settingsService, modelService } = this.options;
    const [cwd, sessionDir] = await Promise.all([
      settingsService.getCurrentCwd(),
      settingsService.getCurrentSessionDir()
    ]);

    const sessions = await SessionManager.list(cwd, sessionDir);
    const target = sessions.find(item => item.id === sessionId);

    if (!target) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const sessionManager = SessionManager.open(target.path, sessionDir, cwd);
    const settingsManager = SettingsManager.create(cwd, settingsService.agentDir);

    // Chaptale 自己的角色 & 创作系统提示词，覆盖 pi 默认 coding 系统提示词；
    // 同时关闭 extensions / 项目上下文文件扫描，避免把 pi CLI 的 coding 行为带进创作会话。
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: settingsService.agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: [systemPrompt, chaptaleSystemPrompt].join('\n\n')
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd,
      agentDir: settingsService.agentDir,
      authStorage: modelService.getAuthStorage(),
      modelRegistry: modelService.getModelRegistry(),
      sessionManager,
      settingsManager,
      resourceLoader,
      // 创作场景：只允许显式注册的白名单工具，避免暴露 read/bash/edit/write 等 coding 工具。
      tools: getEnabledToolNames(),
      customTools: getPiCustomTools()
    });

    return session;
  }
}
