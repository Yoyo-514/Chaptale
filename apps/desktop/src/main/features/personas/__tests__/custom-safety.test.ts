import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseFrontmatter } from '../../../core/frontmatter/parse';
import { SessionStore } from '../../../core/sessions/store';
import { createDefaultToolCatalog } from '../../../core/tool-protocol/catalog';
import { readManagedText } from '../../../infra/filesystem/managed-text';
import { MemoryInjector } from '../../memory/injector';
import { MemoryService } from '../../memory/service';
import { JsonlSessionRepository } from '../../sessions/repository';
import { resolvePersonaMemoryPolicy } from '../memory-access';
import { PersonaRegistry } from '../registry';

let root: string;
let work: string;
let user: string;
const definition = '---\nid: planner\nname: 规划\ntype: plan\nexecution: chat\n---\n询问作者的创作目标。';
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-custom-safety-'));
  work = path.join(root, 'work');
  user = path.join(root, 'user');
  await mkdir(path.join(user, 'personas'), { recursive: true });
  await mkdir(work);
});
afterEach(async () => {
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(root)).toMatch(/^chaptale-custom-safety-/);
  await rm(root, { recursive: true, force: true });
});
function registry() {
  return new PersonaRegistry({ parseFrontmatter, builtinSources: [], userPersonasDir: path.join(user, 'personas') });
}

describe('custom persona safety', () => {
  it('uses least privilege when a hand-written persona omits permissions', async () => {
    await writeFile(path.join(user, 'personas/planner.md'), definition);
    const persona = await registry().get(work, 'planner');
    expect(persona).toMatchObject({ tools: [], memory: { read: [], write: [], propose: [] }, delegatable: false });
    expect(resolvePersonaMemoryPolicy(persona!)).toEqual({ domains: [], author: false });
    const catalog = createDefaultToolCatalog();
    expect(catalog.resolveAllowed({ ...persona!, tools: ['read', 'grep', 'memory_search'] })).toEqual([
      'memory_search'
    ]);
    expect(
      catalog.resolveAllowed({ ...persona!, execution: 'task', tools: ['read', 'grep', 'memory_search'] })
    ).toEqual(['memory_search']);
  });
  it('persists persona per session without changing older sessions', async () => {
    const sessions = path.join(user, 'sessions');
    const repository = new JsonlSessionRepository({ rootDir: user, cwd: work, sessionDir: sessions });
    const first = await repository.create({ id: 'legacy', name: '旧会话' });
    const second = await repository.create({ id: 'planner-session', personaId: 'planner' });
    expect((await SessionStore.open(second.path)).header.personaId).toBe('planner');
    expect((await repository.list()).find(item => item.id === second.id)?.personaId).toBe('planner');
    expect(await readFile(first.path, 'utf8')).not.toContain('personaId');
  });
  it('keeps private notes and author preferences out of restricted injection', async () => {
    await mkdir(path.join(user, 'memory'), { recursive: true });
    await mkdir(path.join(work, '.chaptale/memory/notes'), { recursive: true });
    await mkdir(path.join(work, '.chaptale/memory/summaries'), { recursive: true });
    await writeFile(path.join(user, 'memory/MEMORY.md'), '跨作品作者偏好');
    await writeFile(path.join(work, '.chaptale/memory/notes/private.md'), '观察区私有内容');
    await writeFile(path.join(work, '.chaptale/memory/summaries/recent.md'), '已经确认的情节摘要');
    const memory = new MemoryService({ chaptaleRootDir: user });
    const restricted = new MemoryInjector(memory, async () => ({ domains: ['summaries'], author: false }));
    const first = await restricted.resolvePrefix('session', work, 'planner');
    expect(first).toContain('已经确认的情节摘要');
    expect(first).not.toContain('观察区私有内容');
    expect(first).not.toContain('跨作品作者偏好');
    expect(await restricted.resolvePrefix('session', work, 'planner')).toBe('');
  });
  it('rejects oversized files and linked content directories', async () => {
    await writeFile(path.join(user, 'personas/large.md'), 'x'.repeat(128 * 1024 + 1));
    expect((await registry().load(work)).diagnostics).toHaveLength(1);
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'secret.md'), definition);
    await symlink(outside, path.join(user, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(readManagedText(user, 'linked/secret.md')).rejects.toThrow();
  });
  it('does not register task personas with unknown output contracts', async () => {
    await writeFile(
      path.join(user, 'personas/planner.md'),
      definition.replace('execution: chat', 'execution: task\noutput: invented')
    );
    const loaded = await registry().load(work);
    expect(loaded.personas).toEqual([]);
    expect(loaded.diagnostics[0]?.message).toContain('已注册');
  });
});
