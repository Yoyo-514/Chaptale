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

async function writeSkill(root: string, name: string, description: string) {
  const skillDir = path.join(root, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n按照技能说明执行。\n`,
    'utf8'
  );
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
    const provider = new SkillsProvider({ rootDir } as never);

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
    const provider = new SkillsProvider({ rootDir } as never);

    const result = provider.load(cwd);

    expect(result.skills.map(skill => skill.name)).toEqual(['valid-skill']);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
