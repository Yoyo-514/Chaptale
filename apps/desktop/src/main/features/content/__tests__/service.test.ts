import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ContentEntry, ContentRef } from '@chaptale/shared';
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
function ref(document: ContentEntry): ContentRef {
  const { kind, id, source, sourcePath, hash } = document;
  return { kind, id, source, sourcePath, hash, ...(document.archived ? { archived: true } : {}) };
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-content-'));
  work = path.join(root, 'work');
  user = path.join(root, 'user');
  await mkdir(work);
  settings = new SettingsService(new WebToolsSettingsAdapter(), { rootDir: user });
  await settings.update({ workspace: { path: work } });
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
    await settings.update({ workspace: { path: other } });
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

describe('content lifecycle', () => {
  const archived = async (kind: ContentRef['kind']) => {
    const entry = (await service.list({ rootPath: work })).entries.find(item => item.archived && item.kind === kind);
    expect(entry).toBeDefined();
    return ref(entry!);
  };
  const createSkill = () =>
    service.save({ rootPath: work, scope: 'workspace', kind: 'skill', id: 'my-skill', markdown: skill });
  const remove = async (reference: ContentRef) => {
    const args = { rootPath: work, ref: reference };
    const preview = await service.previewDelete(args);
    await service.delete({ ...args, fingerprint: preview.fingerprint });
  };
  it.each([
    { kind: 'persona', id: 'my-planner', markdown: persona },
    { kind: 'skill', id: 'my-skill', markdown: skill },
    { kind: 'template', id: 'my-template', markdown: template }
  ] as const)('permanently deletes active and archived $kind without trash', async definition => {
    const args = { rootPath: work, scope: 'workspace' as const, ...definition };
    await remove(ref(await service.save(args)));
    expect((await service.list({ rootPath: work })).entries.filter(item => item.source === 'workspace')).toEqual([]);
    const saved = await service.save(args);
    await service.archive({ rootPath: work, ref: ref(saved) });
    const reference = await archived(definition.kind);
    const document = await service.read({ rootPath: work, ref: reference });
    expect(document).toMatchObject({ markdown: definition.markdown, archived: true, effective: false });
    await remove(reference);
    expect((await service.list({ rootPath: work })).entries.filter(item => item.source === 'workspace')).toEqual([]);
  });
  it('restores an override without changing historical files or other layers', async () => {
    await createPersona();
    const saved = await createPersona('workspace', persona.replace('情节策划', '作品策划'));
    const history = path.join(work, '.chaptale/runs/previous.json');
    await mkdir(path.dirname(history), { recursive: true });
    await writeFile(history, '{"personaId":"my-planner","output":"历史正文"}');
    await service.archive({ rootPath: work, ref: ref(saved) });
    const reference = await archived('persona');
    const restored = await service.restore({ rootPath: work, ref: reference });
    expect(restored).toMatchObject({ sourcePath: 'my-planner.md', archived: false, name: '作品策划' });
    expect((await service.list({ rootPath: work })).entries.filter(item => item.effective)).toEqual([
      expect.objectContaining({ source: 'workspace', name: '作品策划' })
    ]);
    await remove(ref(restored));
    expect(await readFile(history, 'utf8')).toBe('{"personaId":"my-planner","output":"历史正文"}');
    expect((await service.list({ rootPath: work })).entries.find(item => item.effective)?.source).toBe('user');
  });
  it('archives and restores the whole skill directory including hidden and binary attachments', async () => {
    const saved = await createSkill();
    const directory = path.join(work, '.chaptale/skills/my-skill');
    await mkdir(path.join(directory, 'references/empty'), { recursive: true });
    await writeFile(path.join(directory, 'references/cover.png'), Buffer.from([0, 1, 2, 3]));
    await writeFile(path.join(directory, '.notes'), '原始笔记');
    await service.archive({ rootPath: work, ref: ref(saved) });
    await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    const reference = await archived('skill');
    const preview = await service.previewDelete({ rootPath: work, ref: reference });
    expect(preview.files).toHaveLength(3);
    expect(preview.files.some(file => file.path.endsWith('references/cover.png'))).toBe(true);
    await service.restore({ rootPath: work, ref: reference });
    expect(await readFile(path.join(directory, 'references/cover.png'))).toEqual(Buffer.from([0, 1, 2, 3]));
    expect(await readFile(path.join(directory, '.notes'), 'utf8')).toBe('原始笔记');
    expect(await readdir(path.join(directory, 'references/empty'))).toEqual([]);
    await remove(ref(saved));
    await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('never deletes a newer active skill when removing a legacy file archive', async () => {
    const saved = await createSkill();
    const directory = path.join(work, '.chaptale/skills');
    const archivePath = `.archive/my-skill-${randomUUID()}.md`;
    await mkdir(path.join(directory, '.archive'));
    await writeFile(path.join(directory, archivePath), skill);
    await writeFile(path.join(directory, 'my-skill/new-reference.txt'), '新技能资料');
    const reference = await archived('skill');
    const preview = await service.previewDelete({ rootPath: work, ref: reference });
    expect(preview.files).toHaveLength(1);
    expect(preview.warnings.join(' ')).toContain('旧格式');
    await service.delete({ rootPath: work, ref: reference, fingerprint: preview.fingerprint });
    expect((await service.read({ rootPath: work, ref: ref(saved) })).markdown).toBe(skill);
    expect(await readFile(path.join(directory, 'my-skill/new-reference.txt'), 'utf8')).toBe('新技能资料');
  });
  it('restores a legacy skill file without replacing its remaining attachments', async () => {
    const directory = path.join(work, '.chaptale/skills');
    await mkdir(path.join(directory, '.archive'), { recursive: true });
    await mkdir(path.join(directory, 'my-skill'));
    await writeFile(path.join(directory, `.archive/my-skill-${randomUUID()}.md`), skill);
    await writeFile(path.join(directory, 'my-skill/reference.txt'), '旧资源');
    await service.restore({ rootPath: work, ref: await archived('skill') });
    expect(await readFile(path.join(directory, 'my-skill/SKILL.md'), 'utf8')).toBe(skill);
    expect(await readFile(path.join(directory, 'my-skill/reference.txt'), 'utf8')).toBe('旧资源');
  });
  it('rejects restore conflicts and leaves both copies intact', async () => {
    const saved = await createPersona();
    await service.archive({ rootPath: work, ref: ref(saved) });
    const reference = await archived('persona');
    await createPersona('user', persona.replace('情节策划', '更新版'));
    await expect(service.restore({ rootPath: work, ref: reference })).rejects.toThrow('同 id');
    expect((await service.read({ rootPath: work, ref: reference })).markdown).toBe(persona);
    expect(await readFile(path.join(user, 'personas/my-planner.md'), 'utf8')).toContain('更新版');
  });
  it('does not mistake archives for active import conflicts', async () => {
    const saved = await createPersona();
    const bundles = new ContentBundles(service);
    const text = await bundles.previewExport({ rootPath: work, refs: [ref(saved)] });
    await service.archive({ rootPath: work, ref: ref(saved) });
    expect((await bundles.previewImport({ rootPath: work, scope: 'user', text })).entries[0].conflict).toBeUndefined();
    expect(
      await bundles.import({
        rootPath: work,
        scope: 'user',
        text,
        selected: [{ kind: 'persona', id: 'my-planner' }]
      })
    ).toEqual({ imported: ['persona:my-planner'], errors: [] });
    expect((await service.list({ rootPath: work })).entries.filter(item => item.source === 'user')).toHaveLength(2);
  });
  it.each(['changed', 'added', 'removed', 'empty-directory'] as const)(
    'rejects a delete confirmation after an attachment is %s',
    async change => {
      const saved = await createSkill();
      const directory = path.join(work, '.chaptale/skills/my-skill');
      const attachment = path.join(directory, 'reference.txt');
      await writeFile(attachment, 'before');
      const args = { rootPath: work, ref: ref(saved) };
      const preview = await service.previewDelete(args);
      if (change === 'changed') await writeFile(attachment, 'after!');
      if (change === 'added') await writeFile(path.join(directory, 'new.txt'), 'new');
      if (change === 'removed') await rm(attachment);
      if (change === 'empty-directory') await mkdir(path.join(directory, 'new'));
      await expect(service.delete({ ...args, fingerprint: preview.fingerprint })).rejects.toThrow('删除范围已变化');
      expect(await readFile(path.join(directory, 'SKILL.md'), 'utf8')).toBe(skill);
    }
  );
  it('rejects stale source hashes and stale workspaces before deletion', async () => {
    const saved = await createPersona();
    const args = { rootPath: work, ref: ref(saved) };
    const preview = await service.previewDelete(args);
    await writeFile(path.join(user, 'personas/my-planner.md'), persona + '外部修订');
    await expect(service.delete({ ...args, fingerprint: preview.fingerprint })).rejects.toThrow('内容已变化');
    const other = path.join(root, 'other');
    await mkdir(other);
    await settings.update({ workspace: { path: other } });
    await expect(service.delete({ ...args, fingerprint: preview.fingerprint })).rejects.toThrow('作品已切换');
    expect(await readFile(path.join(user, 'personas/my-planner.md'), 'utf8')).toBe(persona + '外部修订');
  });
  it('keeps builtins read-only and rejects arbitrary archive paths', async () => {
    const builtin = ref((await service.list({ rootPath: work })).entries[0]);
    const args = { rootPath: work, ref: builtin };
    await expect(service.previewDelete(args)).rejects.toThrow('内置');
    await expect(service.delete({ ...args, fingerprint: '0'.repeat(64) })).rejects.toThrow('内置');
    await expect(service.restore({ ...args, ref: { ...builtin, archived: true } })).rejects.toThrow('内置');
    const saved = await createPersona();
    for (const sourcePath of ['.archive/../../settings.json', '.archive/my-planner.md', '.hidden/my-planner.md']) {
      await expect(
        service.read({ rootPath: work, ref: { ...ref(saved), sourcePath, archived: true } })
      ).rejects.toThrow();
    }
    await service.archive({ rootPath: work, ref: ref(saved) });
    const reference = await archived('persona');
    await expect(service.read({ rootPath: work, ref: { ...reference, archived: false } })).rejects.toThrow('路径');
  });
  it('rejects linked skill attachments and never touches their targets', async () => {
    const saved = await createSkill();
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'keep.txt'), '不可删除');
    await symlink(
      outside,
      path.join(work, '.chaptale/skills/my-skill/linked'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await expect(service.previewDelete({ rootPath: work, ref: ref(saved) })).rejects.toThrow();
    await expect(service.archive({ rootPath: work, ref: ref(saved) })).rejects.toThrow();
    expect(await readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('不可删除');
  });
  it('refuses oversized attachment scans without deleting anything', async () => {
    const saved = await createSkill();
    const attachment = path.join(work, '.chaptale/skills/my-skill/large.bin');
    await writeFile(attachment, '');
    await truncate(attachment, 64 * 1024 * 1024 + 1);
    await expect(service.previewDelete({ rootPath: work, ref: ref(saved) })).rejects.toThrow('64 MiB');
    expect((await service.read({ rootPath: work, ref: ref(saved) })).markdown).toBe(skill);
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
