import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { validateOutput } from '@chaptale/shared';

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

const builtinReviewerExpectations = [
  {
    id: 'continuity-reviewer',
    output: 'continuity-issues',
    agentType: 'continuity',
    severity: 'high',
    summary: '发现一处时间线冲突。',
    forbiddenTexts: ['"id"', '"location"', '"description"', '"schemaVersion"', '"source"'],
    assertIssue: (issue: Record<string, unknown>) => {
      expect(issue).toMatchObject({
        agentType: 'continuity',
        severity: 'high',
        type: 'timeline',
        quote: '第三天，他第一次来到这里。',
        reason: '前文已说明角色第一天到达。',
        suggestion: '统一抵达时间。',
        position: { start: 12, end: 26 }
      });
    }
  },
  {
    id: 'character-reviewer',
    output: 'character-issues',
    agentType: 'character',
    severity: 'medium',
    summary: '发现一处人物动机问题。',
    forbiddenTexts: ['"id"', '"location"', '"description"', '"schemaVersion"', '"source"'],
    assertIssue: (issue: Record<string, unknown>) => {
      expect(issue).toMatchObject({
        agentType: 'character',
        severity: 'medium',
        type: 'weak_motivation',
        quote: '他决定立刻离开。',
        reason: '前文尚未建立离开的动机。',
        suggestion: '补足离开的触发事件。',
        expectedBehavior: '角色应先表现犹豫，再因线索推动离开。',
        characterId: 'hero',
        position: { start: 5, end: 13 }
      });
    }
  },
  {
    id: 'style-reviewer',
    output: 'style-issues',
    agentType: 'style',
    severity: 'low',
    summary: '发现一处文风拖沓问题。',
    forbiddenTexts: ['"id"', '"location"', '"description"', '"schemaVersion"', '"source"'],
    assertIssue: (issue: Record<string, unknown>) => {
      expect(issue).toMatchObject({
        agentType: 'style',
        severity: 'low',
        type: 'over_explaining',
        quote: '她非常非常伤心，因为她的心情非常不好。',
        reason: '解释性重复过多，削弱情绪力度。',
        suggestion: '压缩解释，保留更直接的情绪呈现。',
        rewriteSuggestion: '她喉间发紧，话到嘴边又咽了回去。',
        position: { start: 20, end: 39 }
      });
    }
  }
] as const;

function extractJsonExample(body: string) {
  const match = body.match(/```json\s*([\s\S]*?)\s*```/);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]) as {
    issues: Array<Record<string, unknown>>;
    summary: unknown;
  };
}

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

  it('loads the builtin reviewer personas with the shared reviewer contract', async () => {
    const { personas, diagnostics } = await createRegistry().load(cwd);

    expect(diagnostics).toEqual([]);

    for (const expected of builtinReviewerExpectations) {
      const persona = personas.find(candidate => candidate.id === expected.id);

      expect(persona).toMatchObject({
        source: 'builtin',
        type: 'review',
        execution: 'task',
        output: expected.output,
        enabled: true,
        memory: { read: ['canon', 'summaries'], write: [], propose: [] }
      });
      expect(persona?.tools ?? []).toEqual([]);
      expect(persona?.skills ?? []).toEqual(['review-checklist']);

      const body = persona?.body ?? '';
      expect(body).toContain('<output>');
      expect(body).toContain('逐字引用');

      const example = extractJsonExample(body);
      const validation = validateOutput(expected.output, example);
      if (!validation.ok) {
        throw new Error(validation.errors.join('\n'));
      }

      expect(example.summary).toBe(expected.summary);
      expect(example.issues).toHaveLength(1);
      expect(example.issues[0]?.agentType).toBe(expected.agentType);
      expect(example.issues[0]?.severity).toBe(expected.severity);
      expected.assertIssue(example.issues[0] ?? {});

      for (const text of expected.forbiddenTexts) {
        expect(body).not.toContain(text);
      }
    }
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
      'character-reviewer',
      'companion',
      'continuity-reviewer',
      'good',
      'memory-distiller',
      'style-reviewer'
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
