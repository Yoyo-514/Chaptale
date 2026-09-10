import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ModelService } from '../../../core/models/service';
import { SettingsService } from '../../../core/settings/service';
import { MAX_MANAGED_TEXT_BYTES } from '../../../infra/filesystem/managed-text';
import { TaskSessionFactory } from '../../tasks/session-factory';
import { WebToolsSettingsAdapter } from '../../web-tools/adapter';
import { SkillsProvider } from '../provider';
import { createSkillReadTool } from '../skill-read-tool';

let home: string;
let work: string;
let skillDir: string;
let settings: SettingsService;
let provider: SkillsProvider;
const skill = '---\nname: bounded-skill\ndescription: 读取检查\nappliesTo: [companion]\n---\n保留作者原意。\n';
beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'chaptale-bounded-skills-'));
  work = path.join(home, 'work');
  skillDir = path.join(work, '.chaptale/skills/bounded-skill');
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, 'SKILL.md'), skill);
  settings = new SettingsService(new WebToolsSettingsAdapter(), { rootDir: path.join(home, 'user') });
  await settings.ensureBaseDirs();
  provider = new SkillsProvider(settings);
});
afterEach(async () => {
  expect(path.dirname(home)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(home)).toMatch(/^chaptale-bounded-skills-/);
  await rm(home, { recursive: true, force: true });
});
const tool = () => createSkillReadTool({ skillsProvider: provider, cwd: work, personaId: 'companion' });

describe('真实技能文件读取', () => {
  it('主文件和辅助文件正常读取，拒绝超限、二进制及无效 UTF-8', async () => {
    expect((await tool().execute({ id: 'bounded-skill' })).text).toContain('保留作者原意');
    const auxiliary = path.join(skillDir, 'reference.md');
    await writeFile(auxiliary, '辅助原文');
    expect((await tool().execute({ id: 'bounded-skill', path: 'reference.md' })).text).toBe('辅助原文');
    await writeFile(auxiliary, Buffer.alloc(MAX_MANAGED_TEXT_BYTES, 0x61));
    expect((await tool().execute({ id: 'bounded-skill', path: 'reference.md' })).text).toContain('单次读取预算');
    await writeFile(auxiliary, Buffer.alloc(MAX_MANAGED_TEXT_BYTES + 1, 0x61));
    await expect(tool().execute({ id: 'bounded-skill', path: 'reference.md' })).rejects.toThrow('普通文本');
    await writeFile(auxiliary, Buffer.from([0x61, 0, 0x62]));
    await expect(tool().execute({ id: 'bounded-skill', path: 'reference.md' })).rejects.toThrow('不是文本');
    await writeFile(auxiliary, Buffer.from([0xff, 0xfe, 0x61]));
    await expect(tool().execute({ id: 'bounded-skill', path: 'reference.md' })).rejects.toThrow();
  });

  it('拒绝辅助目录链接与越界，不泄露目录外文本', async () => {
    const outside = path.join(home, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'private.md'), '目录外的文本');
    await symlink(outside, path.join(skillDir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(tool().execute({ id: 'bounded-skill', path: 'linked/private.md' })).rejects.toThrow();
    await expect(tool().execute({ id: 'bounded-skill', path: '../../private.md' })).rejects.toThrow('作品之外');
    expect((await tool().execute({ id: 'bounded-skill' })).text).not.toContain('linked');
  });

  it('深层目录清单明确不完整，但显式辅助路径仍可读取', async () => {
    const relative = 'one/two/three/four/five/reference.md';
    await mkdir(path.dirname(path.join(skillDir, relative)), { recursive: true });
    await writeFile(path.join(skillDir, relative), '深入参考');
    const result = await tool().execute({ id: 'bounded-skill' });
    expect(result.text).toContain('未列全');
    expect(result.text).not.toContain(relative);
    expect((await tool().execute({ id: 'bounded-skill', path: relative })).text).toBe('深入参考');
  });

  it('超过扫描上限不报告虚假的精确余量', async () => {
    for (let offset = 0; offset < 304; offset += 8) {
      await Promise.all(
        Array.from({ length: 8 }, (_, index) => writeFile(path.join(skillDir, `ref-${offset + index}.md`), '参考'))
      );
    }
    const result = await tool().execute({ id: 'bounded-skill' });
    expect(result.text).toContain('扫描数量或深度上限');
    expect(result.text).not.toMatch(/还有 \d+ 个文件/);
  });

  it('真实任务工厂冻结技能且不调用模型，损坏主文件不能创建任务', async () => {
    await writeFile(
      settings.modelsPath,
      JSON.stringify({
        defaultModel: { provider: 'local-fixture', modelId: 'fixture' },
        providers: {
          'local-fixture': {
            api: 'openai-completions',
            baseUrl: 'https://example.invalid/v1',
            apiKey: 'fixture-not-a-real-key',
            models: [{ id: 'fixture' }]
          }
        }
      })
    );
    const factory = new TaskSessionFactory({
      settingsService: settings,
      modelService: new ModelService({ modelsPath: settings.modelsPath }),
      buildTaskTools: async () => [],
      skillsProvider: provider
    });
    const spec = {
      personaId: 'fixture-reviewer',
      systemPrompt: '检查文本',
      tools: [],
      skills: ['bounded-skill'],
      memoryReadDomains: [],
      frozenContext: true
    };
    const first = await factory.createTaskSession(spec, work);
    const originalHash = first.getMetadata?.().promptTemplateHash;
    expect(originalHash).toMatch(/^[a-f0-9]{64}$/);
    await writeFile(path.join(skillDir, 'SKILL.md'), skill + '\n新增作者约定。');
    const second = await factory.createTaskSession(spec, work);
    expect(second.getMetadata?.().promptTemplateHash).not.toBe(originalHash);
    expect(first.getMetadata?.().promptTemplateHash).toBe(originalHash);
    first.dispose();
    second.dispose();
    await writeFile(path.join(skillDir, 'SKILL.md'), skill + 'x'.repeat(MAX_MANAGED_TEXT_BYTES));
    await expect(factory.createTaskSession(spec, work)).rejects.toThrow('绑定技能不可用');
    expect(await readFile(path.join(skillDir, 'SKILL.md'), 'utf8')).toHaveLength(skill.length + MAX_MANAGED_TEXT_BYTES);
  });
});
