import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { LoadedSkill } from '../../../core/agent/skills';
import type { SkillProvider } from '../provider-port';
import { createSkillReadTool } from '../skill-read-tool';

function fakeProvider(skills: LoadedSkill[]): Pick<SkillProvider, 'load'> {
  return { load: async () => ({ skills, diagnostics: [] }) };
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function createSkillFile(body: string): Promise<LoadedSkill> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-skill-'));
  tempDirs.push(dir);
  const filePath = path.join(dir, 'SKILL.md');
  await writeFile(filePath, body, 'utf8');

  return { name: 'review-checklist', description: '审查清单', filePath, source: 'builtin', appliesTo: [] };
}

/** 在技能目录内建辅助文件，返回技能与辅助文件的相对路径。 */
async function createSkillWithAuxiliary() {
  const skill = await createSkillFile('# 审查清单\n\n1. 时间线');
  const skillDir = path.dirname(skill.filePath);
  const auxPath = 'references/示例清单.md';
  await mkdir(path.join(skillDir, 'references'), { recursive: true });
  await writeFile(path.join(skillDir, auxPath), '辅助正文', 'utf8');

  return { skill, auxPath };
}

describe('createSkillReadTool', () => {
  it('命中 id 返回 SKILL.md 全文', async () => {
    const skill = await createSkillFile('# 审查清单\n\n1. 时间线');
    const tool = createSkillReadTool({ skillsProvider: fakeProvider([skill]), cwd: '/cwd' });

    const result = await tool.execute({ id: 'review-checklist' });

    expect(result).toMatchObject({ text: '# 审查清单\n\n1. 时间线' });
    expect(result).not.toHaveProperty('isError');
  });

  /**
   * 工具结果预算的截断形态是保留首尾、省略中间——流程文档被挖掉中间几步，
   * 模型会照着读下去而不自知。技能正文因此自己先按头部优先截断。
   */
  it('超长正文按头部优先截断，不挖空中间', async () => {
    const skill = await createSkillFile(`第一步：开头锚点\n${'流程正文。'.repeat(3_000)}\n最后一步：结尾锚点`);
    const tool = createSkillReadTool({ skillsProvider: fakeProvider([skill]), cwd: '/cwd' });

    const { text } = await tool.execute({ id: 'review-checklist' });

    expect(text).toContain('第一步：开头锚点');
    expect(text).toContain('正文超出单次读取预算');
    // 尾部保留会让模型误以为读到了完整流程。
    expect(text).not.toContain('最后一步：结尾锚点');
  });

  it('id 不存在返回提示文本，不抛错', async () => {
    const tool = createSkillReadTool({ skillsProvider: fakeProvider([]), cwd: '/cwd' });

    const result = await tool.execute({ id: 'no-such-skill' });

    expect(result.text).toContain('没有名为「no-such-skill」的可用技能');
  });

  it('allowedNames 收窄可用集：未声明的技能不可读', async () => {
    const skill = await createSkillFile('正文');
    const tool = createSkillReadTool({
      skillsProvider: fakeProvider([skill]),
      allowedNames: ['other-skill'],
      cwd: '/cwd'
    });

    const result = await tool.execute({ id: 'review-checklist' });

    expect(result.text).toContain('没有名为「review-checklist」的可用技能');
  });

  it('personaId 走 appliesTo 过滤（与 system 注入同一语义）', async () => {
    const skill = await createSkillFile('正文');
    const provider = fakeProvider([skill]);
    const personaFiltered = {
      load: async (cwd: string, personaId?: string) =>
        personaId === 'companion' ? { skills: [], diagnostics: [] } : provider.load(cwd, personaId)
    };
    const tool = createSkillReadTool({ skillsProvider: personaFiltered, personaId: 'companion', cwd: '/cwd' });

    const result = await tool.execute({ id: 'review-checklist' });

    expect(result.text).toContain('没有名为「review-checklist」的可用技能');
  });

  it('正文读取失败降级为提示文本', async () => {
    const skill = {
      name: 'broken',
      description: '坏文件',
      filePath: '/nonexistent/SKILL.md',
      source: 'builtin' as const,
      appliesTo: []
    };
    const tool = createSkillReadTool({ skillsProvider: fakeProvider([skill]), cwd: '/cwd' });

    const result = await tool.execute({ id: 'broken' });

    expect(result.text).toContain('正文为空');
  });

  it('目录型技能：SKILL.md 末尾附其他文件清单', async () => {
    const { skill } = await createSkillWithAuxiliary();
    const tool = createSkillReadTool({ skillsProvider: fakeProvider([skill]), cwd: '/cwd' });

    const result = await tool.execute({ id: 'review-checklist' });

    expect(result.text).toContain('# 审查清单');
    expect(result.text).toContain('references/示例清单.md');
    expect(result.text).toContain('可用 skill_read 的 path 参数读取');
  });

  it('path 参数读取技能目录内辅助文件', async () => {
    const { skill, auxPath } = await createSkillWithAuxiliary();
    const tool = createSkillReadTool({ skillsProvider: fakeProvider([skill]), cwd: '/cwd' });

    const result = await tool.execute({ id: 'review-checklist', path: auxPath });

    expect(result.text).toBe('辅助正文');
  });

  it('path 越界（../ 与绝对路径）拒绝，与 read 同一条红线', async () => {
    const { skill } = await createSkillWithAuxiliary();
    const tool = createSkillReadTool({ skillsProvider: fakeProvider([skill]), cwd: '/cwd' });

    await expect(tool.execute({ id: 'review-checklist', path: '../secret.txt' })).rejects.toThrow('工作区之外');
    await expect(tool.execute({ id: 'review-checklist', path: 'C:/windows/system32/x.md' })).rejects.toThrow(
      '工作区之外'
    );
  });

  it('path 不存在返回提示文本', async () => {
    const { skill } = await createSkillWithAuxiliary();
    const tool = createSkillReadTool({ skillsProvider: fakeProvider([skill]), cwd: '/cwd' });

    const result = await tool.execute({ id: 'review-checklist', path: 'references/不存在.md' });

    expect(result.text).toContain('不存在文件');
  });

  it('清单截断时显式告知余量，不给模型“只有这些”的错觉', async () => {
    const skill = await createSkillFile('正文');
    const skillDir = path.dirname(skill.filePath);

    // 31 个辅助文件：超出 30 上限，末尾必须出现余量提示。
    for (let index = 0; index < 31; index += 1) {
      await writeFile(path.join(skillDir, `ref-${index}.md`), 'x', 'utf8');
    }

    const tool = createSkillReadTool({ skillsProvider: fakeProvider([skill]), cwd: '/cwd' });
    const result = await tool.execute({ id: 'review-checklist' });

    expect(result.text).toContain('ref-0.md');
    // toSorted 字典序下最大的是 ref-9.md，恰好是唯一被截掉的那个。
    expect(result.text).not.toContain('ref-9.md');
    expect(result.text).toContain('还有 1 个文件未列出');
  });
});
