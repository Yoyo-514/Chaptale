import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { inspectFsReadTarget } from '../../permissions/fs-read.ts';
import {
  createSkillTemplate,
  importSkillSource,
  matchSkillReadTarget,
  readWorkDisabledSkills,
  removeManagedSkill,
  resolveSkillReadScopes,
  scanManagedSkills,
  targetsEnabledSkill,
  writeWorkDisabledSkills
} from '../index.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'chaptale-skills-'));
  dirs.push(dir);
  return dir;
}

describe('skills domain', () => {
  it('扫描全局与作品两级目录：作品同名接管全局（含停用时不回退全局），并返回格式告警', async () => {
    const root = await tempDir();
    const globalDir = join(root, 'global-skills');
    const workDir = join(root, 'work-skills');

    await createSkillTemplate({
      rootDir: globalDir,
      name: 'polish-prose',
      description: '全局去翻译腔审校'
    });
    await createSkillTemplate({
      rootDir: globalDir,
      name: 'scene-beats',
      description: '全局场次节拍拆解'
    });
    await createSkillTemplate({
      rootDir: workDir,
      name: 'polish-prose',
      description: '本作品古风审校'
    });
    // 放入一个缺 description 的损坏 SKILL.md 验证 pi 诊断透传
    await mkdir(join(workDir, 'broken-skill'), { recursive: true });
    await writeFile(join(workDir, 'broken-skill', 'SKILL.md'), '---\nname: broken-skill\n---\n正文\n', 'utf8');

    const active = scanManagedSkills({
      globalDir,
      disabledGlobal: [],
      workDir,
      disabledWork: []
    });
    expect(active.enabledSkills.map(s => ({ name: s.name, desc: s.description }))).toEqual([
      { name: 'polish-prose', desc: '本作品古风审校' },
      { name: 'scene-beats', desc: '全局场次节拍拆解' }
    ]);
    const globalOverridden = active.snapshot.skills.find(s => s.scope === 'global' && s.name === 'polish-prose');
    expect(globalOverridden?.overriddenByWork).toBe(true);
    expect(active.snapshot.diagnostics.some(d => d.path.includes('broken-skill'))).toBe(true);

    // 停用作品级同名技能后，该名称在本作品停用，不意外回退到全局旧版
    await writeWorkDisabledSkills(workDir, ['polish-prose']);
    const disabledWork = await readWorkDisabledSkills(workDir);
    const afterDisable = scanManagedSkills({
      globalDir,
      disabledGlobal: [],
      workDir,
      disabledWork
    });
    expect(afterDisable.enabledSkills.map(s => s.name)).toEqual(['scene-beats']);
  });

  it('支持导入多文件技能文件夹与单个 .md 文件，拒绝含符号链接目录与重名覆盖，并支持安全移入回收暂存区', async () => {
    const root = await tempDir();
    const globalDir = join(root, 'global-skills');
    const external = join(root, 'external');

    // 1. 多文件技能文件夹导入
    const pkgDir = join(external, 'tang-titles');
    await mkdir(join(pkgDir, 'references'), { recursive: true });
    await writeFile(
      join(pkgDir, 'SKILL.md'),
      '---\nname: tang-titles\ndescription: 唐代官制与称谓核对\n---\n请核对 references/ranks.md。\n',
      'utf8'
    );
    await writeFile(join(pkgDir, 'references', 'ranks.md'), '正一品：太师\n', 'utf8');

    const importedPkg = await importSkillSource({ rootDir: globalDir, sourcePath: pkgDir });
    expect(importedPkg).toEqual(['tang-titles']);
    await expect(importSkillSource({ rootDir: globalDir, sourcePath: pkgDir })).rejects.toThrow(/已存在/);

    // 2. 单个 .md 文件导入
    const singleFile = join(external, 'dialogue-check.md');
    await writeFile(singleFile, '---\ndescription: 对白潜台词检查\n---\n逐句核对潜台词。\n', 'utf8');
    const importedFile = await importSkillSource({ rootDir: globalDir, sourcePath: singleFile });
    expect(importedFile).toEqual(['dialogue-check']);

    // 3. 含符号链接的外部目录拒绝导入
    const symlinkPkg = join(external, 'evil-skill');
    await mkdir(symlinkPkg, { recursive: true });
    await writeFile(join(symlinkPkg, 'SKILL.md'), '---\ndescription: 恶意链接\n---\n', 'utf8');
    const secretFile = join(root, 'secret.txt');
    await writeFile(secretFile, 'secret', 'utf8');
    let symlinkCreated = true;
    try {
      await symlink(secretFile, join(symlinkPkg, 'leak.md'));
    } catch {
      symlinkCreated = false;
    }
    if (symlinkCreated) {
      await expect(importSkillSource({ rootDir: globalDir, sourcePath: symlinkPkg })).rejects.toThrow(/符号链接/);
    }

    // 4. 移除技能：移入 .trash 暂存目录，扫描立即不再出现；越界路径拒绝
    const beforeRemove = scanManagedSkills({ globalDir, disabledGlobal: [], workDir: null, disabledWork: [] });
    const targetSkill = beforeRemove.snapshot.skills.find(s => s.name === 'dialogue-check')!;
    const removed = await removeManagedSkill({ rootDir: globalDir, filePath: targetSkill.filePath });
    expect(removed.files).toHaveLength(1);
    expect(removed.files[0]).toContain('.trash');
    const afterRemove = scanManagedSkills({ globalDir, disabledGlobal: [], workDir: null, disabledWork: [] });
    expect(afterRemove.snapshot.skills.map(s => s.name)).toEqual(['tang-titles']);
    await expect(removeManagedSkill({ rootDir: globalDir, filePath: secretFile })).rejects.toThrow(/不在当前技能目录/);
  });

  it('只读范围放行技能子目录与根目录单文件，拦截越界符号链接并识别技能名', async () => {
    const root = await tempDir();
    const cwd = join(root, 'cwd');
    const globalDir = join(root, 'global-skills');
    const outsideDir = join(root, 'outside');
    await mkdir(cwd, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, 'secret.md'), '机密设定', 'utf8');

    await createSkillTemplate({
      rootDir: globalDir,
      name: 'enabled-pkg',
      description: '已启用多文件技能'
    });
    await mkdir(join(globalDir, 'enabled-pkg', 'references'), { recursive: true });
    const refFile = join(globalDir, 'enabled-pkg', 'references', 'table.md');
    await writeFile(refFile, '表格', 'utf8');

    await createSkillTemplate({
      rootDir: globalDir,
      name: 'disabled-pkg',
      description: '已停用技能'
    });
    // 技能根目录直接手工放一个单文件 .md，不能连带放行整个 globalDir（否则会放行 disabled-pkg）
    const rootLooseMd = join(globalDir, 'loose-note.md');
    await writeFile(rootLooseMd, '---\nname: loose-note\ndescription: 根目录单文件技能\n---\n内容\n', 'utf8');

    const { enabledSkills } = scanManagedSkills({
      globalDir,
      disabledGlobal: ['disabled-pkg'],
      workDir: null,
      disabledWork: []
    });
    const scopes = await resolveSkillReadScopes(enabledSkills, [globalDir]);

    // 1. 已启用子目录的 SKILL.md 与 references/ 均自动放行并识别技能名
    const readRef = await inspectFsReadTarget('read', { path: refFile }, cwd);
    expect(targetsEnabledSkill(scopes, readRef?.target)).toBe(true);
    expect(matchSkillReadTarget(scopes, readRef?.target)).toEqual({ skillName: 'enabled-pkg' });

    // 2. 根目录单文件自身放行，但同级的已停用子目录不放行
    const readLoose = await inspectFsReadTarget('read', { path: rootLooseMd }, cwd);
    expect(targetsEnabledSkill(scopes, readLoose?.target)).toBe(true);
    const readDisabled = await inspectFsReadTarget('read', { path: join(globalDir, 'disabled-pkg', 'SKILL.md') }, cwd);
    expect(targetsEnabledSkill(scopes, readDisabled?.target)).toBe(false);

    // 3. 已启用技能目录内若存在指向目录外的符号链接，realpath 解析后拦截
    const linkInSkill = join(globalDir, 'enabled-pkg', 'references', 'escape.md');
    let linked = true;
    try {
      await symlink(join(outsideDir, 'secret.md'), linkInSkill);
    } catch {
      linked = false;
    }
    if (linked) {
      const readEscape = await inspectFsReadTarget('read', { path: linkInSkill }, cwd);
      expect(targetsEnabledSkill(scopes, readEscape?.target)).toBe(false);
    }
  });
});
