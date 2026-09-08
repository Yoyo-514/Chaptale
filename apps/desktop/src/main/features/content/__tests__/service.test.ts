import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ContentDocument, ContentRef } from '@chaptale/shared';
import { parseDocumentFrontmatter, patchDocumentFields } from '@chaptale/shared/document-frontmatter';

import { parseFrontmatter } from '../../../core/frontmatter/parse';
import { SettingsService } from '../../../core/settings/service';
import { PersonaRegistry } from '../../personas/registry';
import { SkillsProvider } from '../../skills/provider';
import { TemplateService } from '../../templates/service';
import { WebToolsSettingsAdapter } from '../../web-tools/adapter';
import { WorkspaceService } from '../../workspace/service';
import { ContentBundles, parseContentBundle } from '../bundles';
import { contentHash, describeContent } from '../codec';
import { ContentService } from '../service';

let root: string;
let work: string;
let user: string;
let settings: SettingsService;
let workspace: WorkspaceService;
let service: ContentService;
const persona = '---\nid: my-planner\nname: 情节策划\ntype: custom\nexecution: chat\n---\n保留作者确认的故事目标。\n';
const skill =
  '---\nname: my-skill\ndescription: 检查场景转折\nappliesTo: [my-planner]\n---\n辨认场景中不可逆的选择。\n';
const template =
  '---\ntemplate: my-template\nname: 我的模板\ntargetKind: note\ntargetRole: inspiration\nfields:\n  - key: title\n    label: 标题\n    type: text\n---\n# {{title}}\n\n正文。\n';
function ref(document: ContentDocument): ContentRef {
  const { kind, id, source, sourcePath, hash } = document;
  return { kind, id, source, sourcePath, hash };
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-content-'));
  work = path.join(root, 'work');
  user = path.join(root, 'user');
  await mkdir(work);
  settings = new SettingsService(new WebToolsSettingsAdapter(), { rootDir: user });
  await settings.update({ storage: { mode: 'workspace', workspacePath: work } });
  workspace = new WorkspaceService(settings);
  service = new ContentService({
    userRoot: user,
    currentWorkspace: async () => (await workspace.getState()).rootPath,
    builtins: [{ kind: 'persona', markdown: persona }]
  });
});
afterEach(async () => {
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(root)).toMatch(/^chaptale-content-/);
  await rm(root, { recursive: true, force: true });
});
const createPersona = (scope: 'user' | 'workspace' = 'user', markdown = persona) =>
  service.save({ rootPath: work, scope, kind: 'persona', id: 'my-planner', markdown });

describe('local content management', () => {
  it('saves content in the real persona, skill and template loaders', async () => {
    const saved = await createPersona();
    await service.save({ rootPath: work, scope: 'workspace', kind: 'skill', id: 'my-skill', markdown: skill });
    await service.save({ rootPath: work, scope: 'workspace', kind: 'template', id: 'my-template', markdown: template });
    const registry = new PersonaRegistry({
      parseFrontmatter,
      builtinSources: [],
      userPersonasDir: path.join(user, 'personas')
    });
    expect(await registry.get(work, 'my-planner')).toMatchObject({ source: 'user', tools: [], delegatable: false });
    expect((await new SkillsProvider(settings).load(work, 'my-planner')).skills).toEqual([
      expect.objectContaining({ name: 'my-skill' })
    ]);
    expect((await new TemplateService(workspace, path.join(user, 'templates')).list(work)).templates).toContainEqual(
      expect.objectContaining({ template: 'my-template', source: 'workspace' })
    );
    expect((await service.read({ rootPath: work, ref: ref(saved) })).markdown).toBe(persona);
  });
  it('keeps all layers inspectable and archives without losing the original file', async () => {
    await createPersona();
    const custom = await createPersona('workspace', persona.replace('情节策划', '作品策划'));
    const list = await service.list({ rootPath: work });
    expect(list.entries.filter(item => item.effective)).toEqual([
      expect.objectContaining({ source: 'workspace', name: '作品策划' })
    ]);
    expect(list.entries).toHaveLength(3);
    await service.archive({ rootPath: work, ref: ref(custom) });
    expect((await service.list({ rootPath: work })).entries.find(item => item.effective)?.source).toBe('user');
    const archived = await readdir(path.join(work, '.chaptale/personas/.archive'));
    expect(archived).toHaveLength(1);
    expect(await readFile(path.join(work, '.chaptale/personas/.archive', archived[0]), 'utf8')).toBe(custom.markdown);
  });
  it('rejects stale hashes, duplicate creation and concurrent updates', async () => {
    const saved = await createPersona();
    await expect(createPersona()).rejects.toThrow();
    const update = {
      rootPath: work,
      scope: 'user' as const,
      kind: 'persona' as const,
      id: saved.id,
      expectedHash: saved.hash,
      sourcePath: saved.sourcePath
    };
    const attempts = await Promise.allSettled([
      service.save({ ...update, markdown: persona.replace('情节策划', '第一版') }),
      service.save({ ...update, markdown: persona.replace('情节策划', '第二版') })
    ]);
    expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    await expect(service.archive({ rootPath: work, ref: ref(saved) })).rejects.toThrow('内容已变化');
  });
  it('does not apply a stale management dialog to another work', async () => {
    await createPersona();
    const other = path.join(root, 'other');
    await mkdir(other);
    await settings.update({ storage: { mode: 'workspace', workspacePath: other } });
    await expect(createPersona('workspace')).rejects.toThrow('作品已切换');
    await expect(service.list({ rootPath: work })).rejects.toThrow('作品已切换');
  });
  it('rejects linked directories, path escape and oversized text', async () => {
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(user, 'personas'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(createPersona()).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
    await expect(
      service.save({
        rootPath: work,
        scope: 'workspace',
        kind: 'persona',
        id: 'my-planner',
        sourcePath: '../escape.md',
        markdown: persona
      })
    ).rejects.toThrow();
    expect(() => describeContent('persona', `${persona}${'长'.repeat(128 * 1024)}`)).toThrow('128 KiB');
    expect(() => describeContent('template', template.replace('key: title', 'key: __proto__'))).toThrow('受保护字段');
    expect(() =>
      describeContent('persona', persona.replace('execution: chat', 'execution: task\noutput: unknown'))
    ).toThrow('输出格式');
  });
});

describe('portable content bundles', () => {
  it('previews complete text while removing model and permissions from personas', async () => {
    const privileged = patchDocumentFields(persona, {
      model: { preference: 'private/model' },
      tools: ['write', 'delegate', 'read'],
      memory: { read: ['canon', 'notes', 'summaries', 'author'], write: ['notes'], propose: ['canon'] },
      enabled: true,
      delegatable: true
    });
    const saved = await createPersona('user', privileged);
    const bundles = new ContentBundles(service);
    const text = await bundles.previewExport({ rootPath: work, refs: [ref(saved)] });
    const bundle = parseContentBundle(text);
    const head = parseDocumentFrontmatter(bundle.entries[0].markdown);
    expect(head.status).toBe('ok');
    if (head.status !== 'ok') throw new Error('missing header');
    expect(head.frontmatter).toMatchObject({
      tools: [],
      memory: { read: [], write: [], propose: [] },
      delegatable: false,
      enabled: false
    });
    expect(head.frontmatter).not.toHaveProperty('model');
    expect(head.body).toContain('保留作者确认');
    const preview = await bundles.previewImport({ rootPath: work, scope: 'workspace', text });
    expect(preview.entries[0].warnings).toHaveLength(1);
    const result = await bundles.import({
      rootPath: work,
      scope: 'workspace',
      text,
      selected: [{ kind: 'persona', id: saved.id }]
    });
    expect(result).toEqual({ imported: ['persona:my-planner'], errors: [] });
    const registry = new PersonaRegistry({
      parseFrontmatter,
      builtinSources: [],
      userPersonasDir: path.join(user, 'personas')
    });
    expect(await registry.get(work, saved.id)).toBeUndefined();
  });
  it('requires an explicit current overwrite token and rejects tampered bundles', async () => {
    const saved = await createPersona();
    const bundles = new ContentBundles(service);
    const text = await bundles.previewExport({ rootPath: work, refs: [ref(saved)] });
    const preview = await bundles.previewImport({ rootPath: work, scope: 'user', text });
    const choice = { kind: 'persona' as const, id: saved.id };
    const rejected = await bundles.import({ rootPath: work, scope: 'user', text, selected: [choice] });
    expect(rejected.errors).toHaveLength(1);
    expect(await readFile(path.join(user, 'personas/my-planner.md'), 'utf8')).toBe(persona);
    const result = await bundles.import({
      rootPath: work,
      scope: 'user',
      text,
      selected: [{ ...choice, overwrite: preview.entries[0].conflict }]
    });
    expect(result.errors).toEqual([]);
    expect(
      (await bundles.import({ rootPath: work, scope: 'user', text, selected: [{ ...choice, overwrite: ref(saved) }] }))
        .errors
    ).toHaveLength(1);
    expect(() => parseContentBundle(text.replace('保留作者', '窃改作者'))).toThrow('校验失败');
    const bundle = parseContentBundle(text);
    expect(() =>
      parseContentBundle(JSON.stringify({ ...bundle, entries: [...bundle.entries, ...bundle.entries] }))
    ).toThrow('重复');
    expect(() => parseContentBundle(JSON.stringify({ ...bundle, version: 99 }))).toThrow('版本');
    expect(bundle.entries[0].hash).toBe(contentHash(bundle.entries[0].markdown));
  });
});
