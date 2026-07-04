import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type SessionInfo
} from '@earendil-works/pi-coding-agent';
import { promises as fs } from 'node:fs';
import path from 'node:path';

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
    const target = await findSessionById(settingsService, sessionId);

    if (!target) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const cwd = target.cwd || (await settingsService.getCurrentCwd());
    const sessionDir = path.dirname(target.path);
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

async function findSessionById(settingsService: SettingsService, sessionId: string): Promise<SessionInfo | undefined> {
  const sessionDirs = await getKnownSessionDirs(settingsService);

  for (const sessionDir of sessionDirs) {
    const sessions = await SessionManager.listAll(sessionDir);
    const target = sessions.find(item => item.id === sessionId);

    if (target) {
      return target;
    }
  }

  return undefined;
}

async function getKnownSessionDirs(settingsService: SettingsService) {
  const currentSessionDir = await settingsService.getCurrentSessionDir();
  await fs.mkdir(settingsService.sessionsRootDir, { recursive: true });

  const entries = await fs.readdir(settingsService.sessionsRootDir, { withFileTypes: true });
  const dirs = entries
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(settingsService.sessionsRootDir, entry.name));

  return [...new Set([currentSessionDir, ...dirs])];
}
