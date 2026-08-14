import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * 自有 SKILL.md 加载器（替代 pi loadSkillsFromDir）。
 *
 * 目录约定：<dir>/<skill-name>/SKILL.md（Kebab-case，与目录名一致）；
 * frontmatter 仅支持单行标量 name/description 与内联数组 appliesTo——
 * 这是文档约定的唯一格式，不支持的多行/嵌套语法按解析失败降级。
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
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { skills: [], diagnostics: [] };
  }

  const skills: LoadedSkill[] = [];
  const diagnostics: SkillDiagnostic[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const filePath = path.join(dir, entry.name, SKILL_FILE);

    try {
      const content = await fs.readFile(filePath, 'utf8');
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
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!match) {
    return null;
  }

  const frontmatter = match[1];
  const name = matchScalar(frontmatter, 'name');
  const description = matchScalar(frontmatter, 'description');
  const appliesTo = matchInlineArray(frontmatter, 'appliesTo');

  return {
    name: name ?? '',
    description: description ?? '',
    appliesTo: appliesTo ?? []
  };
}

function matchScalar(frontmatter: string, key: string): string | null {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  return match ? stripQuotes(match[1] ?? '') : null;
}

function matchInlineArray(frontmatter: string, key: string): string[] | null {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]\\s*$`, 'm'));

  if (!match) {
    return null;
  }

  return (match[1] ?? '')
    .split(',')
    .map(item => stripQuotes(item.trim()))
    .filter(Boolean);
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

/** appliesTo 绑定：缺省或空数组 = 全部 persona 可用。 */
export function skillAppliesTo(appliesTo: string[], personaId: string): boolean {
  return appliesTo.length === 0 || appliesTo.includes(personaId);
}
