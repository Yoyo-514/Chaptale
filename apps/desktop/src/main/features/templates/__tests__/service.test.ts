import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { parseDocumentFrontmatter } from '@chaptale/shared/document-frontmatter';

import { readDocumentSnapshot } from '../../workspace/read-document';
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
      getStorageContext: async () => ({ workspacePath: root })
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
  it('识别仅补元数据，保留正文、既有字段与注释，并拒绝过期和重复识别', async () => {
    const template = (await service.list(root)).templates.find(value => value.template === 'character-main')!;
    const source = '\uFEFF---\r\ncustom: 0xFF # 保留\r\nimportance: hidden\r\n---\r\n自由原文。\n第二行。\r\n';
    await writeFile(path.join(root, '随记.md'), source);
    const original = await readDocumentSnapshot({ rootPath: root, relativePath: '随记.md', maxBytes: 1024 });
    const args = {
      rootPath: root,
      relativePath: '随记.md',
      expectedHash: original.contentHash,
      templateId: template.template,
      templateHash: template.hash
    };
    await expect(service.identify({ ...args, expectedHash: '0'.repeat(64) })).rejects.toThrow('已变化');
    const result = await service.identify(args);
    expect(result.head).toMatchObject({
      status: 'ok',
      frontmatter: { kind: 'character', title: '随记', importance: 'hidden' },
      body: original.head.body
    });
    expect(result.content).toContain('custom: 0xFF # 保留\r\n');
    expect(result.content.startsWith('\uFEFF')).toBe(true);
    expect(result.content).not.toContain('一句话定位');
    await expect(service.identify({ ...args, expectedHash: result.contentHash })).rejects.toThrow('已经分类');
    await writeFile(path.join(root, '随记.md'), '---\ncustom: [\n---\n原文');
    const broken = await readDocumentSnapshot({ rootPath: root, relativePath: '随记.md', maxBytes: 1024 });
    await expect(service.identify({ ...args, expectedHash: broken.contentHash })).rejects.toThrow('修正元数据');
    expect(await readFile(path.join(root, '随记.md'), 'utf8')).toBe(broken.content);
  });
  it('内置十三种，作品覆盖作者版本，坏模板诊断且不覆盖合法定义', async () => {
    expect((await service.list(root)).templates).toHaveLength(13);
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
  it('故事事件保留虚构纪年并落在作品设定的时间线中', async () => {
    const template = (await service.list(root)).templates.find(value => value.template === 'story-event')!;
    const args = {
      rootPath: root,
      templateId: template.template,
      templateHash: template.hash,
      filename: '夜航.md',
      values: { title: '夜航', order: -0.5, when: '清河历八年冬，子夜之后', strand: '归途' }
    };
    const document = await service.create(args);
    expect(document.relativePath).toBe('设定/时间线/夜航.md');
    expect(document.head).toMatchObject({ status: 'ok', frontmatter: { kind: 'timeline-event', ...args.values } });
    expect(await readFile(path.join(root, document.relativePath), 'utf8')).toBe(document.content);
    await expect(service.create({ ...args, filename: '空.md', values: { title: '   ' } })).rejects.toThrow('不能为空');
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
