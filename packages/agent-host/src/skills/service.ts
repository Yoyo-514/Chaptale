import type { Skill } from '@earendil-works/pi-coding-agent';
import { resolve } from 'node:path';

import { matchesFsReadPermission, sameFsPath } from '../permissions/fs-read.ts';
import type {
  ManagedSkillsSnapshot,
  ManagedSkillView,
  SessionSkillItem,
  SkillScope,
  ToolResultInfo
} from '../protocol/index.ts';
import type { AppSettingsStore } from '../settings/app-settings.ts';
import { resolveSkillReadScopes, scanManagedSkills, type SkillReadScope, targetsEnabledSkill } from './discovery.ts';
import { createSkillTemplate, importSkillSource, removeManagedSkill } from './manage.ts';
import { globalSkillsDir, readWorkDisabledSkills, setWorkSkillEnabled, workSkillsDir } from './store.ts';

const fsReadToolNames = new Set(['read', 'ls', 'find', 'grep']);

function computeFingerprint(skills: readonly Skill[]): string {
  return JSON.stringify(
    skills.map(skill => ({
      name: skill.name,
      description: skill.description,
      disableModelInvocation: skill.disableModelInvocation,
      filePath: skill.filePath
    }))
  );
}

/**
 * 单个会话持有的已启用技能快照：
 * - 空闲发起新回合前调用 `refresh()` 重扫磁盘并标记是否需要 `session.reload()`；
 * - 请求运行期间不调用 `refresh()`，保持当前提示词与只读放行目录锁定。
 */
export class SessionSkillsState {
  private readonly load: () => Promise<{
    skills: Skill[];
    readScopes: SkillReadScope[];
    literalScopes: SkillReadScope[];
  }>;
  private skills: Skill[] = [];
  private readScopes: SkillReadScope[] = [];
  private literalScopes: SkillReadScope[] = [];
  private fingerprint = '';
  private reloadPending = false;

  constructor(
    load: () => Promise<{
      skills: Skill[];
      readScopes: SkillReadScope[];
      literalScopes: SkillReadScope[];
    }>
  ) {
    this.load = load;
  }

  async refresh(initial = false): Promise<void> {
    const next = await this.load();
    const nextFp = computeFingerprint(next.skills);
    if (!initial && nextFp !== this.fingerprint) {
      this.reloadPending = true;
    }
    this.skills = next.skills;
    this.readScopes = next.readScopes;
    this.literalScopes = next.literalScopes;
    this.fingerprint = nextFp;
  }

  consumeReload(): boolean {
    const needed = this.reloadPending;
    this.reloadPending = false;
    return needed;
  }

  currentSkills(): Skill[] {
    return [...this.skills];
  }

  allowsTarget(realTarget: string | undefined): boolean {
    return targetsEnabledSkill(this.readScopes, realTarget);
  }

  matchToolTarget(cwd: string, toolName: string | undefined, input: unknown): ToolResultInfo | undefined {
    if (!toolName || !fsReadToolNames.has(toolName)) return undefined;
    const rawPath = (input as { path?: unknown } | null)?.path;
    if (typeof rawPath !== 'string' || !rawPath.trim()) return undefined;
    const resolved = resolve(cwd, rawPath);
    const hit =
      this.readScopes.find(scope => matchesFsReadPermission(scope, resolved)) ??
      this.literalScopes.find(scope => matchesFsReadPermission(scope, resolved));
    return hit ? { skillName: hit.name } : undefined;
  }
}

export interface HostSkillsServiceDeps {
  agentDir: string;
  settings: AppSettingsStore;
  resolveWorkFilesDir: (workId: string) => Promise<string>;
}

/** 宿主层的两级 Skills 管理与会话技能状态工厂。 */
export class HostSkillsService {
  private readonly deps: HostSkillsServiceDeps;

  constructor(deps: HostSkillsServiceDeps) {
    this.deps = deps;
  }

  private async resolveScopeDir(scope: SkillScope, workId: string | null): Promise<string> {
    if (scope === 'global') return globalSkillsDir(this.deps.agentDir);
    if (!workId) throw new Error('作品级技能需要指定目标作品');
    return workSkillsDir(await this.deps.resolveWorkFilesDir(workId));
  }

  private async scan(workId: string | null) {
    const globalDir = globalSkillsDir(this.deps.agentDir);
    const workDir = workId ? workSkillsDir(await this.deps.resolveWorkFilesDir(workId)) : null;
    const disabledWork = workDir ? await readWorkDisabledSkills(workDir) : [];
    return scanManagedSkills({
      globalDir,
      disabledGlobal: this.deps.settings.disabledGlobalSkills,
      workDir,
      disabledWork
    });
  }

  async list(workId: string | null): Promise<ManagedSkillsSnapshot> {
    return (await this.scan(workId)).snapshot;
  }

  async sessionItems(workId: string | null): Promise<SessionSkillItem[]> {
    return [...(await this.scan(workId)).sessionItems].sort((a, b) => a.name.localeCompare(b.name));
  }

  async setEnabled(input: {
    scope: SkillScope;
    workId: string | null;
    name: string;
    enabled: boolean;
  }): Promise<ManagedSkillsSnapshot> {
    if (input.scope === 'global') {
      await this.deps.settings.setGlobalSkillEnabled(input.name, input.enabled);
    } else {
      const dir = await this.resolveScopeDir('work', input.workId);
      await setWorkSkillEnabled(dir, input.name, input.enabled);
    }
    return this.list(input.workId);
  }

  async create(input: {
    scope: SkillScope;
    workId: string | null;
    name: string;
    description: string;
    disableModelInvocation?: boolean;
  }): Promise<{ skill: ManagedSkillView; snapshot: ManagedSkillsSnapshot }> {
    const rootDir = await this.resolveScopeDir(input.scope, input.workId);
    const filePath = await createSkillTemplate({
      rootDir,
      name: input.name,
      description: input.description,
      disableModelInvocation: input.disableModelInvocation
    });
    const snapshot = await this.list(input.workId);
    const skill = snapshot.skills.find(item => sameFsPath(item.filePath, filePath));
    if (!skill) throw new Error('技能模板创建后未能加载');
    return { skill, snapshot };
  }

  async import(input: {
    scope: SkillScope;
    workId: string | null;
    sourcePath: string;
  }): Promise<{ imported: string[]; snapshot: ManagedSkillsSnapshot }> {
    const rootDir = await this.resolveScopeDir(input.scope, input.workId);
    const imported = await importSkillSource({ rootDir, sourcePath: input.sourcePath });
    const snapshot = await this.list(input.workId);
    return { imported, snapshot };
  }

  async remove(input: {
    scope: SkillScope;
    workId: string | null;
    filePath: string;
  }): Promise<{ files: string[]; snapshot: ManagedSkillsSnapshot }> {
    const rootDir = await this.resolveScopeDir(input.scope, input.workId);
    const current = await this.list(input.workId);
    const matched = current.skills.find(
      item => item.scope === input.scope && sameFsPath(item.filePath, input.filePath)
    );
    const { files } = await removeManagedSkill({ rootDir, filePath: input.filePath });
    if (matched) {
      if (input.scope === 'global') {
        await this.deps.settings.setGlobalSkillEnabled(matched.name, true);
      } else {
        await setWorkSkillEnabled(rootDir, matched.name, true);
      }
    }
    const snapshot = await this.list(input.workId);
    return { files, snapshot };
  }

  async createSessionState(workId: string | null): Promise<SessionSkillsState> {
    const state = new SessionSkillsState(async () => {
      const scanned = await this.scan(workId);
      const roots = [scanned.snapshot.globalDir, ...(scanned.snapshot.workDir ? [scanned.snapshot.workDir] : [])];
      const readScopes = await resolveSkillReadScopes(scanned.enabledSkills, roots);
      const literalScopes: SkillReadScope[] = scanned.enabledSkills.map(skill => {
        const isRootLoose = roots.some(root => sameFsPath(resolve(skill.baseDir), resolve(root)));
        return isRootLoose
          ? { name: skill.name, path: resolve(skill.filePath), pathKind: 'file' }
          : { name: skill.name, path: resolve(skill.baseDir), pathKind: 'directory' };
      });
      return { skills: scanned.enabledSkills, readScopes, literalScopes };
    });
    await state.refresh(true);
    return state;
  }
}
