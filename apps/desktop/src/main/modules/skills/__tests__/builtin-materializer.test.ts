import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { builtinSkillSources } from '../builtin';
import { materializeBuiltinSkills } from '../builtin-materializer';

const tempDirs: string[] = [];

function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaptale-builtin-skills-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('materializeBuiltinSkills', () => {
  it('writes every bundled skill to the target directory', () => {
    const target = path.join(createTempDir(), 'builtin-skills');

    materializeBuiltinSkills(target);

    const files = fs.readdirSync(target).toSorted();
    expect(files).toEqual(builtinSkillSources.map(skill => skill.fileName).toSorted());

    for (const skill of builtinSkillSources) {
      expect(fs.readFileSync(path.join(target, skill.fileName), 'utf8')).toBe(skill.source);
    }
  });

  it('removes stale files from previous versions on rewrite', () => {
    const target = path.join(createTempDir(), 'builtin-skills');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'removed-skill.md'), '旧版本残留', 'utf8');

    materializeBuiltinSkills(target);

    expect(fs.existsSync(path.join(target, 'removed-skill.md'))).toBe(false);
    expect(fs.readdirSync(target)).toHaveLength(builtinSkillSources.length);
  });

  it('bundles sources with valid frontmatter names matching file names', () => {
    for (const skill of builtinSkillSources) {
      const name = skill.source.match(/^name:\s*(.+)$/m)?.[1]?.trim();
      expect(name).toBe(skill.fileName.replace(/\.md$/, ''));
    }
  });
});
