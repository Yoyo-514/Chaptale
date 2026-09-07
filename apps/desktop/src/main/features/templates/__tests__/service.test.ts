import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { parseDocumentFrontmatter } from '@chaptale/shared/document-frontmatter';

import { WorkspaceService } from '../../workspace/service';
import { TemplateService } from '../service';

let home: string;
let root: string;
let service: TemplateService;
const custom = (name: string) =>
  `---\ntemplate: scene-card\nname: ${name}\ntargetKind: scene-card\ntargetRole: outline\nfields:\n  - { key: title, label: 标题, type: text, required: true }\n  - { key: goal, label: 目标, type: textarea }\n---\n# {{title}}\n`;
beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'chaptale-templates-'));
  root = path.join(home, 'book');
  await mkdir(path.join(root, '卡片模板'), { recursive: true });
  await mkdir(path.join(home, 'templates'));
  await writeFile(
    path.join(root, 'chaptale.json'),
    JSON.stringify({ dirs: { templates: '卡片模板', outline: '规划' } })
  );
  service = new TemplateService(
    new WorkspaceService({
      getStorageContext: async () => ({ storageMode: 'workspace', workspacePath: root })
    }),
    path.join(home, 'templates')
  );
});
afterEach(async () => {
  expect(path.dirname(path.resolve(home))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(home).startsWith('chaptale-templates-')).toBe(true);
  await rm(home, { recursive: true, force: true });
});
describe('模板三层与文件创建', () => {
  it('内置十二种，作品覆盖作者版本，坏模板诊断且不覆盖合法定义', async () => {
    expect((await service.list(root)).templates).toHaveLength(12);
    await writeFile(path.join(home, 'templates/scene.md'), custom('作者版本'));
    expect((await service.list(root)).templates.find(value => value.template === 'scene-card')?.name).toBe('作者版本');
    await writeFile(path.join(root, '卡片模板/scene.md'), custom('作品版本'));
    await writeFile(path.join(root, '卡片模板/bad.md'), '---\ntemplate: broken\n---\n无字段');
    const result = await service.list(root);
    expect(result.templates.find(value => value.template === 'scene-card')).toMatchObject({
      name: '作品版本',
      source: 'workspace'
    });
    expect(result.diagnostics).toHaveLength(1);
  });
  it('生成文件遵守目录角色、稳定 id 与模板 hash，同名绝不覆盖', async () => {
    const template = (await service.list(root)).templates.find(value => value.template === 'scene-card')!;
    const args = {
      rootPath: root,
      templateId: template.template,
      templateHash: template.hash,
      filename: '桥下.md',
      values: { title: '桥下', goal: '交换信件', chapter: '[[正文/一.md]]' }
    };
    const document = await service.create(args);
    expect(document.relativePath).toBe('规划/场景卡/桥下.md');
    expect(parseDocumentFrontmatter(document.content)).toMatchObject({
      status: 'ok',
      frontmatter: {
        kind: 'scene-card',
        title: '桥下',
        settled: false,
        templateId: 'scene-card',
        templateHash: template.hash
      }
    });
    await expect(service.create(args)).rejects.toThrow('同名');
    expect(await readFile(path.join(root, document.relativePath), 'utf8')).toBe(document.content);
  });
  it('模板变化、必填缺失、类型错误、越界和受保护字段都失败', async () => {
    const template = (await service.list(root)).templates.find(value => value.template === 'scene-card')!;
    const args = {
      rootPath: root,
      templateId: template.template,
      templateHash: template.hash,
      filename: '场景.md',
      values: { title: '场景' }
    };
    await expect(service.create({ ...args, values: {} })).rejects.toThrow('不能为空');
    await expect(service.create({ ...args, values: { ...args.values, lengthHint: '长' } })).rejects.toThrow('类型');
    await expect(service.create({ ...args, directory: '../outside' })).rejects.toThrow();
    await expect(service.create({ ...args, values: { ...args.values, kind: 'chapter' } })).rejects.toThrow('未声明');
    await writeFile(path.join(root, '卡片模板/scene.md'), custom('新版本'));
    await expect(service.create(args)).rejects.toThrow('模板已变化');
  });
});
