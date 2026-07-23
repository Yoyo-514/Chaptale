import { loadSkillsFromDir } from '@earendil-works/pi-coding-agent';
import type { LoadSkillsResult, Skill } from '@earendil-works/pi-coding-agent';
import fs from 'node:fs';
import path from 'node:path';

import type { SettingsService } from '../../../modules/settings/service';
import type { SkillProvider } from '../../../modules/skills/provider';

/** 使用 pi loader 读取磁盘 Skill，并只向应用层暴露稳定的 SkillProvider 能力。 */
export class SkillsProvider implements SkillProvider {
  constructor(private readonly settingsService: SettingsService) {}

  load(cwd: string, personaId?: string): LoadSkillsResult {
    const builtin = loadSkillsFromDir({
      dir: this.settingsService.builtinSkillsDir,
      source: 'builtin'
    });
    const user = loadSkillsFromDir({
      dir: path.join(this.settingsService.rootDir, 'skills'),
      source: 'user'
    });
    const workspace = loadSkillsFromDir({
      dir: path.join(cwd, '.chaptale', 'skills'),
      source: 'project'
    });
    const skillsByName = new Map<string, Skill>();

    // 同名覆盖次序：内置 < 用户级 < 作品级。
    for (const skill of [...builtin.skills, ...user.skills, ...workspace.skills]) {
      if (isValidSkillName(skill.name)) {
        skillsByName.set(skill.name, skill);
      }
    }

    const merged = [...skillsByName.values()];

    return {
      // appliesTo 过滤在覆盖之后进行：以最终生效的那份 skill 文件的声明为准。
      skills: personaId ? merged.filter(skill => appliesToPersona(skill, personaId)) : merged,
      diagnostics: [...builtin.diagnostics, ...user.diagnostics, ...workspace.diagnostics]
    };
  }
}

function isValidSkillName(name: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 64;
}

/**
 * skill frontmatter 的 appliesTo 绑定：缺省或空数组 = 全部 persona 可用。
 *
 * pi 的 Skill 对象不透传自定义 frontmatter 键，因此这里重读文件解析；
 * 读取/解析失败一律放行（绑定是收窄手段，解析问题不应让 skill 消失）。
 */
function appliesToPersona(skill: Skill, personaId: string): boolean {
  let content: string;

  try {
    content = fs.readFileSync(skill.filePath, 'utf8');
  } catch {
    return true;
  }

  const appliesTo = parseAppliesTo(content);
  return !appliesTo || appliesTo.length === 0 || appliesTo.includes(personaId);
}

/** 只支持内联数组写法 `appliesTo: [a, b]`（文档约定的唯一格式）。 */
function parseAppliesTo(content: string): string[] | null {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!frontmatter) {
    return null;
  }

  const line = frontmatter[1].match(/^appliesTo:\s*\[([^\]]*)\]\s*$/m);

  if (!line) {
    return null;
  }

  return line[1]
    .split(',')
    .map(item => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}
