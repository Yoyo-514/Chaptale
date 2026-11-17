import { loadSkillsFromDir, type ResourceDiagnostic, type Skill } from '@earendil-works/pi-coding-agent';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import { matchesFsReadPermission, sameFsPath } from '../permissions/fs-read.ts';
import type {
  ManagedSkillsSnapshot,
  ManagedSkillView,
  SessionSkillItem,
  SkillDiagnosticView,
  SkillScope,
  ToolResultInfo
} from '../protocol/index.ts';

export interface ScanManagedSkillsOptions {
  globalDir: string;
  disabledGlobal: readonly string[];
  workDir: string | null;
  disabledWork: readonly string[];
}

export interface ScanManagedSkillsResult {
  snapshot: ManagedSkillsSnapshot;
  enabledSkills: Skill[];
  sessionItems: SessionSkillItem[];
}

export interface SkillReadScope {
  name: string;
  path: string;
  pathKind: 'directory' | 'file';
}

function toDiagnosticViews(diagnostics: readonly ResourceDiagnostic[]): SkillDiagnosticView[] {
  return diagnostics.map(item => ({
    type: item.type,
    message: item.message,
    path: item.path ?? ''
  }));
}

function dedupeScopeSkills(skills: readonly Skill[], diagnostics: SkillDiagnosticView[]): Skill[] {
  const byName = new Map<string, Skill>();
  for (const skill of skills) {
    const existing = byName.get(skill.name);
    if (existing) {
      diagnostics.push({
        type: 'collision',
        message: `技能名称“${skill.name}”在同一目录下重复，已保留 ${existing.filePath}`,
        path: skill.filePath
      });
      continue;
    }
    byName.set(skill.name, skill);
  }
  return [...byName.values()];
}

function toManagedView(
  skill: Skill,
  scope: SkillScope,
  disabled: ReadonlySet<string>,
  overriddenByWork = false
): ManagedSkillView {
  return {
    name: skill.name,
    description: skill.description,
    scope,
    enabled: !disabled.has(skill.name),
    disableModelInvocation: skill.disableModelInvocation,
    filePath: skill.filePath,
    baseDir: skill.baseDir,
    ...(overriddenByWork && { overriddenByWork: true })
  };
}

/**
 * 扫描全局与可选作品技能目录：
 * - 作品级存在同名技能时接管该名称（作品级启用则用作品级，作品级停用则不在本作品回退全局旧版）；
 * - 返回界面管理快照与供原生会话装配的已启用 Skill 列表。
 */
export function scanManagedSkills(options: ScanManagedSkillsOptions): ScanManagedSkillsResult {
  const diagnostics: SkillDiagnosticView[] = [];
  const disabledGlobal = new Set(options.disabledGlobal);
  const disabledWork = new Set(options.disabledWork);

  const workLoaded = options.workDir
    ? loadSkillsFromDir({ dir: options.workDir, source: 'project' })
    : { skills: [], diagnostics: [] };
  diagnostics.push(...toDiagnosticViews(workLoaded.diagnostics));
  const workSkills = dedupeScopeSkills(workLoaded.skills, diagnostics);
  const workNames = new Set(workSkills.map(skill => skill.name));

  const globalLoaded = loadSkillsFromDir({ dir: options.globalDir, source: 'user' });
  diagnostics.push(...toDiagnosticViews(globalLoaded.diagnostics));
  const globalSkills = dedupeScopeSkills(globalLoaded.skills, diagnostics);

  const views: ManagedSkillView[] = [
    ...workSkills.map(skill => toManagedView(skill, 'work', disabledWork)),
    ...globalSkills.map(skill => toManagedView(skill, 'global', disabledGlobal, workNames.has(skill.name)))
  ];

  const enabledSkills: Skill[] = [
    ...workSkills.filter(skill => !disabledWork.has(skill.name)),
    ...globalSkills.filter(skill => !workNames.has(skill.name) && !disabledGlobal.has(skill.name))
  ];

  const sessionItems: SessionSkillItem[] = [
    ...workSkills
      .filter(skill => !disabledWork.has(skill.name))
      .map(skill => ({
        name: skill.name,
        description: skill.description,
        scope: 'work' as const,
        disableModelInvocation: skill.disableModelInvocation
      })),
    ...globalSkills
      .filter(skill => !workNames.has(skill.name) && !disabledGlobal.has(skill.name))
      .map(skill => ({
        name: skill.name,
        description: skill.description,
        scope: 'global' as const,
        disableModelInvocation: skill.disableModelInvocation
      }))
  ];

  return {
    snapshot: {
      globalDir: options.globalDir,
      workDir: options.workDir,
      skills: views,
      diagnostics
    },
    enabledSkills,
    sessionItems
  };
}

/**
 * 计算已启用技能允许只读工具自动访问的真实路径范围：
 * - 独立子目录中的技能放行该技能子目录（realpath），目录外的软链目标不会命中；
 * - 直接放在技能根目录下的单文件 .md 仅放行该文件本身，避免连带放行同级已停用技能目录。
 */
export async function resolveSkillReadScopes(
  skills: readonly Skill[],
  skillRootDirs: readonly string[]
): Promise<SkillReadScope[]> {
  const realRoots = await Promise.all(skillRootDirs.map(dir => realpath(dir).catch(() => resolve(dir))));
  const scopes: SkillReadScope[] = [];
  for (const skill of skills) {
    try {
      const [realBase, realFile] = await Promise.all([realpath(skill.baseDir), realpath(skill.filePath)]);
      const isRootLooseFile = realRoots.some(root => sameFsPath(realBase, root));
      scopes.push(
        isRootLooseFile
          ? { name: skill.name, path: realFile, pathKind: 'file' }
          : { name: skill.name, path: realBase, pathKind: 'directory' }
      );
    } catch {
      // 文件在扫描后被外部删除时跳过自动放行。
    }
  }
  return scopes;
}

export function targetsEnabledSkill(scopes: readonly SkillReadScope[], realTarget: string | undefined): boolean {
  if (!realTarget) return false;
  return scopes.some(scope => matchesFsReadPermission(scope, realTarget));
}

export function matchSkillReadTarget(
  scopes: readonly SkillReadScope[],
  realTarget: string | undefined
): ToolResultInfo | undefined {
  if (!realTarget) return undefined;
  const hit = scopes.find(scope => matchesFsReadPermission(scope, realTarget));
  return hit ? { skillName: hit.name } : undefined;
}
