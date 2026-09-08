import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parseDocumentFrontmatter } from '@chaptale/shared/document-frontmatter';

import { readManagedText, resolveManagedPath } from '../../infra/filesystem/managed-text';

/**
 * 自有 SKILL.md 加载器。
 *
 * 目录约定：<dir>/<skill-name>/SKILL.md（Kebab-case，与目录名一致）；
 * frontmatter 与内容管理共用 YAML 解析，支持标准标量和 appliesTo 数组。
 */

export type SkillSource = 'builtin' | 'user' | 'project';

export type LoadedSkill = {
  name: string;
  description: string;
  filePath: string;
  source: SkillSource;
  /** frontmatter 的 appliesTo 声明副本（空 = 全部 persona）。 */
  appliesTo: string[];
};

export type SkillDiagnostic = {
  source: SkillSource;
  message: string;
};

export type SkillDirLoadResult = {
  skills: LoadedSkill[];
  diagnostics: SkillDiagnostic[];
};

const SKILL_FILE = 'SKILL.md';
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 加载单个技能目录；目录不存在视为空集（builtin/user 均可能未安装）。 */
export async function loadSkillsFromDir(dir: string, source: SkillSource): Promise<SkillDirLoadResult> {
  let entries;

  try {
    entries = await fs.readdir(await resolveManagedPath(path.dirname(dir), path.basename(dir)), {
      withFileTypes: true
    });
  } catch {
    return { skills: [], diagnostics: [] };
  }

  const skills: LoadedSkill[] = [];
  const diagnostics: SkillDiagnostic[] = [];

  if (entries.length > 300) diagnostics.push({ source, message: '技能目录超过 300 项，超出部分未读取' });
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name)).slice(0, 300)) {
    if (!entry.isDirectory()) {
      continue;
    }

    const filePath = path.join(dir, entry.name, SKILL_FILE);

    try {
      const content = await readManagedText(path.dirname(dir), `${path.basename(dir)}/${entry.name}/${SKILL_FILE}`);
      const parsed = parseSkillFile(content);

      if (!parsed) {
        diagnostics.push({ source, message: `技能文件缺少有效 frontmatter：${filePath}` });
        continue;
      }

      if (!NAME_PATTERN.test(parsed.name) || parsed.name.length > 64) {
        diagnostics.push({ source, message: `技能名不合法（需 kebab-case 且 ≤64 字符）：${parsed.name}` });
        continue;
      }

      skills.push({
        name: parsed.name,
        description: parsed.description,
        filePath,
        source,
        appliesTo: parsed.appliesTo
      });
    } catch (error) {
      diagnostics.push({ source, message: `技能文件读取失败 ${filePath}：${(error as Error).message}` });
    }
  }

  return { skills, diagnostics };
}

/** 解析 SKILL.md：frontmatter 的 name/description/appliesTo（全部可选，name 缺失则按目录名推断由调用方处理）。 */
export function parseSkillFile(content: string): { name: string; description: string; appliesTo: string[] } | null {
  const parsed = parseDocumentFrontmatter(content);
  if (parsed.status !== 'ok') return null;
  const { name, description, appliesTo } = parsed.frontmatter;
  if (
    (name !== undefined && typeof name !== 'string') ||
    (description !== undefined && typeof description !== 'string') ||
    (appliesTo !== undefined && (!Array.isArray(appliesTo) || appliesTo.some(item => typeof item !== 'string')))
  )
    return null;
  return { name: name ?? '', description: description ?? '', appliesTo: appliesTo ?? [] };
}

/** appliesTo 绑定：缺省或空数组 = 全部 persona 可用。 */
export function skillAppliesTo(appliesTo: string[], personaId: string): boolean {
  return appliesTo.length === 0 || appliesTo.includes(personaId);
}
