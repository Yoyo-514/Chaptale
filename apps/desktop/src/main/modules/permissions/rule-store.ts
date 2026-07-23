import fs from 'node:fs';
import path from 'node:path';

import type { PermissionRule, PermissionScope } from './protocol';

const PERMISSIONS_FILE = 'permissions.json';
const VALID_ACTIONS = new Set(['allow', 'ask', 'deny']);

interface PermissionRuleStoreOptions {
  /** 全局规则目录（~/.chaptale）。 */
  globalDir: string;
  /** 当前工作区根；跟随会话切换动态解析。 */
  resolveCwd: () => Promise<string | null> | string | null;
}

/**
 * 授权规则的三层存储：session 内存、workspace `.chaptale/permissions.json`、global 同名文件。
 * 读取时三层合并交给引擎统一求值（deny 最强，层间无优先级）；坏文件按空规则降级。
 */
export class PermissionRuleStore {
  private readonly sessionRules = new Map<string, PermissionRule[]>();

  constructor(private readonly options: PermissionRuleStoreOptions) {}

  /** 合并三层规则；sessionId 为空时只取持久层。 */
  async collect(sessionId?: string): Promise<PermissionRule[]> {
    return [
      ...((sessionId && this.sessionRules.get(sessionId)) || []),
      ...readRuleFile(await this.workspaceFilePath()),
      ...readRuleFile(path.join(this.options.globalDir, PERMISSIONS_FILE))
    ];
  }

  async addRule(rule: PermissionRule, scope: PermissionScope, sessionId?: string): Promise<void> {
    if (scope === 'session') {
      if (!sessionId) {
        throw new Error('session 级规则必须提供 sessionId');
      }

      const rules = this.sessionRules.get(sessionId) ?? [];
      this.sessionRules.set(sessionId, [...rules, rule]);
      return;
    }

    const filePath =
      scope === 'workspace' ? await this.workspaceFilePath() : path.join(this.options.globalDir, PERMISSIONS_FILE);

    if (!filePath) {
      throw new Error('当前没有工作区，无法写入 workspace 级规则');
    }

    const rules = readRuleFile(filePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify({ rules: [...rules, rule] }, null, 2)}\n`, 'utf8');
  }

  /** 会话结束时释放其内存规则。 */
  clearSession(sessionId: string): void {
    this.sessionRules.delete(sessionId);
  }

  private async workspaceFilePath(): Promise<string | null> {
    const cwd = await this.options.resolveCwd();
    return cwd ? path.join(cwd, '.chaptale', PERMISSIONS_FILE) : null;
  }
}

/** 读规则文件；缺失、损坏或结构非法一律降级为空，合法条目单独保留。 */
function readRuleFile(filePath: string | null): PermissionRule[] {
  if (!filePath) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const rules = (parsed as { rules?: unknown }).rules;

    if (!Array.isArray(rules)) {
      return [];
    }

    return rules.filter(
      (rule): rule is PermissionRule =>
        typeof rule === 'object' &&
        rule !== null &&
        typeof (rule as PermissionRule).pattern === 'string' &&
        (rule as PermissionRule).pattern.length > 0 &&
        VALID_ACTIONS.has((rule as PermissionRule).action)
    );
  } catch {
    return [];
  }
}
