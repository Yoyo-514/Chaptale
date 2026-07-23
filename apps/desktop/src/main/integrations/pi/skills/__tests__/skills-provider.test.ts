import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '../provider';

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-skills-'));
  tempDirs.push(dir);
  return dir;
}

async function writeSkill(root: string, name: string, description: string, appliesTo?: string) {
  const skillDir = path.join(root, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n${appliesTo ? `appliesTo: ${appliesTo}\n` : ''}---\n\n按照技能说明执行。\n`,
    'utf8'
  );
}

function createProvider(rootDir: string) {
  return new SkillsProvider({ rootDir, builtinSkillsDir: path.join(rootDir, 'cache', 'builtin-skills') } as never);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('SkillsProvider', () => {
  it('loads user and workspace skills with workspace precedence', async () => {
    const rootDir = await createTempDir();
    const cwd = await createTempDir();
    await writeSkill(path.join(rootDir, 'skills'), 'review', '用户级审查');
    await writeSkill(path.join(rootDir, 'skills'), 'naming', '用户级命名');
    await writeSkill(path.join(cwd, '.chaptale', 'skills'), 'review', '作品级审查');
    const provider = createProvider(rootDir);

    const result = provider.load(cwd);

    expect(result.skills.map(skill => [skill.name, skill.description])).toEqual([
      ['naming', '用户级命名'],
      ['review', '作品级审查']
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('isolates invalid skills without dropping valid siblings', async () => {
    const rootDir = await createTempDir();
    const cwd = await createTempDir();
    await writeSkill(path.join(rootDir, 'skills'), 'valid-skill', '有效技能');
    await writeSkill(path.join(rootDir, 'skills'), 'Invalid Skill', '无效技能');
    const provider = createProvider(rootDir);

    const result = provider.load(cwd);

    expect(result.skills.map(skill => skill.name)).toEqual(['valid-skill']);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('loads builtin skills with the lowest precedence', async () => {
    const rootDir = await createTempDir();
    const cwd = await createTempDir();
    await writeSkill(path.join(rootDir, 'cache', 'builtin-skills'), 'review', '内置审查');
    await writeSkill(path.join(rootDir, 'cache', 'builtin-skills'), 'naming', '内置命名');
    await writeSkill(path.join(rootDir, 'skills'), 'review', '用户级审查');
    const provider = createProvider(rootDir);

    const result = provider.load(cwd);

    expect(new Map(result.skills.map(skill => [skill.name, skill.description]))).toEqual(
      new Map([
        ['review', '用户级审查'],
        ['naming', '内置命名']
      ])
    );
  });

  it('filters skills by appliesTo when a persona id is given', async () => {
    const rootDir = await createTempDir();
    const cwd = await createTempDir();
    const skillsRoot = path.join(rootDir, 'skills');
    await writeSkill(skillsRoot, 'bound-skill', '仅绑定 rewriter', '[rewriter]');
    await writeSkill(skillsRoot, 'open-skill', '无绑定全部可用');
    await writeSkill(skillsRoot, 'empty-bound', '空数组全部可用', '[]');
    const provider = createProvider(rootDir);

    const forCompanion = provider.load(cwd, 'companion');
    expect(forCompanion.skills.map(skill => skill.name).toSorted()).toEqual(['empty-bound', 'open-skill']);

    const forRewriter = provider.load(cwd, 'rewriter');
    expect(forRewriter.skills.map(skill => skill.name).toSorted()).toEqual([
      'bound-skill',
      'empty-bound',
      'open-skill'
    ]);

    // 不传 personaId 列全量（Slash 菜单等场景）。
    const unfiltered = provider.load(cwd);
    expect(unfiltered.skills).toHaveLength(3);
  });
});
