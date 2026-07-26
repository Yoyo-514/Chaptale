import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { builtinPersonaSources } from '../builtin';
import { PersonaRegistry } from '../registry';

const validPersona = (id: string, name = id) => `---
id: ${id}
name: ${name}
type: chat
execution: chat
---

${name} 的系统提示词正文。
`;

describe('PersonaRegistry', () => {
  let userDir: string;
  let cwd: string;

  beforeEach(async () => {
    userDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-personas-user-'));
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-personas-cwd-'));
  });

  afterEach(async () => {
    await fs.rm(userDir, { recursive: true, force: true });
    await fs.rm(cwd, { recursive: true, force: true });
  });

  function createRegistry(builtinSources: readonly string[] = builtinPersonaSources) {
    return new PersonaRegistry({ parseFrontmatter, builtinSources, userPersonasDir: userDir });
  }

  it('loads the builtin companion persona when no user files exist', async () => {
    const { personas, diagnostics } = await createRegistry().load(cwd);

    expect(diagnostics).toEqual([]);
    const companion = personas.find(persona => persona.id === 'companion');
    expect(companion).toMatchObject({
      source: 'builtin',
      type: 'chat',
      execution: 'chat',
      memory: { read: ['canon', 'notes', 'summaries'], write: ['notes'], propose: ['canon'] }
    });
    expect(companion).not.toHaveProperty('tools');
    expect(companion?.body).toContain('创作伙伴');

    const reviewer = personas.find(persona => persona.id === 'continuity-reviewer');
    expect(reviewer).toMatchObject({
      tools: [],
      memory: { read: ['canon', 'summaries'], write: [], propose: [] }
    });
  });

  it('loads the builtin memory-distiller persona for context compaction', async () => {
    const { personas, diagnostics } = await createRegistry().load(cwd);

    expect(diagnostics).toEqual([]);
    const distiller = personas.find(persona => persona.id === 'memory-distiller');
    expect(distiller).toMatchObject({
      source: 'builtin',
      type: 'custom',
      execution: 'task',
      tools: [],
      output: 'creative-checkpoint'
    });
    expect(distiller?.body).toContain('作者明确陈述');
    expect(distiller?.body).toContain('不得把助手的建议或推断升级为已确认事实');
    expect(distiller?.body).toContain('不执行章节结算');
  });

  it('overrides personas by id with workspace > user > builtin priority', async () => {
    await fs.writeFile(path.join(userDir, 'companion.md'), validPersona('companion', '用户版'), 'utf8');
    const workspaceDir = path.join(cwd, '.chaptale', 'personas');
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(path.join(workspaceDir, 'companion.md'), validPersona('companion', '作品版'), 'utf8');

    const { personas } = await createRegistry().load(cwd);
    const companions = personas.filter(persona => persona.id === 'companion');

    expect(companions).toHaveLength(1);
    expect(companions[0]).toMatchObject({ name: '作品版', source: 'workspace' });
  });

  it('collects diagnostics for invalid files without failing the load', async () => {
    await fs.writeFile(path.join(userDir, 'bad-id.md'), validPersona('Bad_ID'), 'utf8');
    await fs.writeFile(
      path.join(userDir, 'empty-body.md'),
      '---\nid: empty\nname: 空\ntype: chat\nexecution: chat\n---\n',
      'utf8'
    );
    await fs.writeFile(path.join(userDir, 'good.md'), validPersona('good'), 'utf8');

    const { personas, diagnostics } = await createRegistry().load(cwd);

    expect(personas.map(persona => persona.id).toSorted()).toEqual([
      'companion',
      'continuity-reviewer',
      'good',
      'memory-distiller'
    ]);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.every(diagnostic => diagnostic.source === 'user')).toBe(true);
  });

  it('rejects unknown frontmatter fields to keep the contract additive-only', async () => {
    await fs.writeFile(
      path.join(userDir, 'extra.md'),
      '---\nid: extra\nname: 多字段\ntype: chat\nexecution: chat\nunknownField: true\n---\n\n正文。\n',
      'utf8'
    );

    const { personas, diagnostics } = await createRegistry().load(cwd);

    expect(personas.find(persona => persona.id === 'extra')).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
  });

  it('get() hides disabled personas', async () => {
    await fs.writeFile(
      path.join(userDir, 'off.md'),
      '---\nid: off\nname: 停用\ntype: chat\nexecution: chat\nenabled: false\n---\n\n正文。\n',
      'utf8'
    );
    const registry = createRegistry();

    await expect(registry.get(cwd, 'off')).resolves.toBeUndefined();
    await expect(registry.get(cwd, 'companion')).resolves.toBeDefined();
  });
});
