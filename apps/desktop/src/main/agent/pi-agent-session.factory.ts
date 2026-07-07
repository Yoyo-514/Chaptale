import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type SessionInfo
} from '@earendil-works/pi-coding-agent';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { unique } from 'radash';

import { chaptaleSystemPrompt, systemPrompt } from '../prompt';
import type { PiModelService } from '../services/pi-model.service';
import type { SettingsService } from '../services/settings.service';
import { getEnabledToolNames, getPiCustomTools } from '../tools/tool-registry';

const nodeRequire = createRequire(import.meta.url);

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

    // pi-web-access 会读取 PI_CODING_AGENT_DIR/web-search.json；
    // 将其绑定到 Chaptale 自己的 agentDir，避免污染用户全局 ~/.pi 配置。
    process.env.PI_CODING_AGENT_DIR = settingsService.agentDir;

    // Chaptale 自己的角色 & 创作系统提示词，覆盖 pi 默认 coding 系统提示词；
    // 同时只定向加载白名单 pi package，避免把 pi CLI 的 coding 行为带进创作会话。
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: settingsService.agentDir,
      settingsManager,
      additionalExtensionPaths: [resolvePiPackageRoot('pi-web-access')],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      skillsOverride: () => ({ skills: [], diagnostics: [] }),
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
      // 创作场景：启用显式白名单工具。read/grep/find/ls/write/edit 用于工作区与文件能力；bash 暂不开放。
      tools: getEnabledToolNames(),
      customTools: getPiCustomTools()
    });

    return session;
  }
}

function resolvePiPackageRoot(packageName: string): string {
  return path.dirname(nodeRequire.resolve(`${packageName}/package.json`));
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

  return unique([currentSessionDir, ...dirs]);
}
