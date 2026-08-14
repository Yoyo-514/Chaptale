import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadSkillsFromDir, parseSkillFile, skillAppliesTo } from '../skills';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-skills-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeSkill(name: string, frontmatter: string, body = '正文') {
  const skillDir = path.join(dir, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}`, 'utf8');
  return path.join(skillDir, 'SKILL.md');
}

describe('loadSkillsFromDir', () => {
  it('加载合法技能并透传 frontmatter', async () => {
    await writeSkill('outline-helper', 'name: outline-helper\ndescription: 大纲助手');

    const result = await loadSkillsFromDir(dir, 'user');

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({
      name: 'outline-helper',
      description: '大纲助手',
      source: 'user'
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('目录不存在 → 空集不报错（builtin/user 可能未安装）', async () => {
    const result = await loadSkillsFromDir(path.join(dir, 'ghost'), 'builtin');

    expect(result.skills).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('缺 frontmatter / 非法技能名 → 进 diagnostics 且不进列表', async () => {
    await writeSkill('bad-name', 'name: Bad_Name\ndescription: x');
    // 无 frontmatter 的文件
    const skillDir = path.join(dir, 'no-frontmatter');
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), '只有正文', 'utf8');

    const result = await loadSkillsFromDir(dir, 'project');

    expect(result.skills).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.map(item => item.message).join('\n')).toMatch(/不合法|frontmatter/);
  });
});

describe('parseSkillFile', () => {
  it('解析单行标量与内联数组（含引号剥离）', () => {
    const parsed = parseSkillFile(
      '---\nname: "story-review"\ndescription: \'作品审查\'\nappliesTo: [blueprint, "companion"]\n---\n\n正文'
    );

    expect(parsed).toEqual({
      name: 'story-review',
      description: '作品审查',
      appliesTo: ['blueprint', 'companion']
    });
  });

  it('CRLF 行尾兼容；缺省字段回空值', () => {
    const parsed = parseSkillFile('---\r\nname: x\r\n---\r\n正文');

    expect(parsed).toEqual({ name: 'x', description: '', appliesTo: [] });
  });

  it('无 frontmatter 分隔符 → null', () => {
    expect(parseSkillFile('没有分隔符')).toBeNull();
  });
});

describe('skillAppliesTo', () => {
  it('空数组 = 全部 persona 可用；有值按成员判定', () => {
    expect(skillAppliesTo([], 'companion')).toBe(true);
    expect(skillAppliesTo(['blueprint'], 'blueprint')).toBe(true);
    expect(skillAppliesTo(['blueprint'], 'companion')).toBe(false);
  });
});
