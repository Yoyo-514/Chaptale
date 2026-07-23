import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { PermissionRuleStore } from '../rule-store';

const tempDirs: string[] = [];

function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaptale-permissions-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('PermissionRuleStore', () => {
  it('merges session, workspace and global layers', async () => {
    const globalDir = createTempDir();
    const cwd = createTempDir();
    const store = new PermissionRuleStore({ globalDir, resolveCwd: () => cwd });

    await store.addRule({ pattern: 'bash(git *)', action: 'allow' }, 'session', 's1');
    await store.addRule({ pattern: 'write', action: 'allow' }, 'workspace');
    await store.addRule({ pattern: 'bash(rm *)', action: 'deny' }, 'global');

    expect((await store.collect('s1')).map(rule => rule.pattern)).toEqual(['bash(git *)', 'write', 'bash(rm *)']);
    // 其他会话看不到 s1 的会话级规则。
    expect((await store.collect('s2')).map(rule => rule.pattern)).toEqual(['write', 'bash(rm *)']);
  });

  it('persists workspace rules across store instances and appends on repeat', async () => {
    const globalDir = createTempDir();
    const cwd = createTempDir();
    await new PermissionRuleStore({ globalDir, resolveCwd: () => cwd }).addRule(
      { pattern: 'edit', action: 'allow' },
      'workspace'
    );

    const reloaded = new PermissionRuleStore({ globalDir, resolveCwd: () => cwd });
    await reloaded.addRule({ pattern: 'write', action: 'allow' }, 'workspace');

    expect((await reloaded.collect()).map(rule => rule.pattern)).toEqual(['edit', 'write']);
  });

  it('lists persistent rules by scope and removes all exact duplicates from one scope', async () => {
    const globalDir = createTempDir();
    const cwd = createTempDir();
    const store = new PermissionRuleStore({ globalDir, resolveCwd: () => cwd });

    await store.addRule({ pattern: 'write(src/example.ts)', action: 'allow' }, 'workspace');
    await store.addRule({ pattern: 'write(src/example.ts)', action: 'allow' }, 'workspace');
    await store.addRule({ pattern: 'write(src/example.ts)', action: 'allow' }, 'global');
    await store.addRule({ pattern: 'bash(rm *)', action: 'deny' }, 'global');

    expect(await store.listPersistentRules()).toEqual({
      workspace: [
        { pattern: 'write(src/example.ts)', action: 'allow' },
        { pattern: 'write(src/example.ts)', action: 'allow' }
      ],
      global: [
        { pattern: 'write(src/example.ts)', action: 'allow' },
        { pattern: 'bash(rm *)', action: 'deny' }
      ]
    });

    await store.removePersistentRule({ pattern: 'write(src/example.ts)', action: 'allow' }, 'workspace');

    expect(await store.listPersistentRules()).toEqual({
      workspace: [],
      global: [
        { pattern: 'write(src/example.ts)', action: 'allow' },
        { pattern: 'bash(rm *)', action: 'deny' }
      ]
    });
  });

  it('degrades corrupt files to empty and keeps only valid entries', async () => {
    const globalDir = createTempDir();
    const cwd = createTempDir();
    fs.mkdirSync(path.join(cwd, '.chaptale'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.chaptale', 'permissions.json'), '{ 不是 JSON', 'utf8');
    fs.writeFileSync(
      path.join(globalDir, 'permissions.json'),
      JSON.stringify({
        rules: [{ pattern: 'read', action: 'allow' }, { pattern: '', action: 'allow' }, { action: 'deny' }, 42]
      }),
      'utf8'
    );

    const store = new PermissionRuleStore({ globalDir, resolveCwd: () => cwd });
    expect(await store.collect()).toEqual([{ pattern: 'read', action: 'allow' }]);
  });

  it('rejects workspace writes without a workspace and session writes without a session id', async () => {
    const store = new PermissionRuleStore({ globalDir: createTempDir(), resolveCwd: () => null });
    await expect(store.addRule({ pattern: 'write', action: 'allow' }, 'workspace')).rejects.toThrow();
    await expect(store.addRule({ pattern: 'write', action: 'allow' }, 'session')).rejects.toThrow();
  });

  it('clears session rules on release', async () => {
    const store = new PermissionRuleStore({ globalDir: createTempDir(), resolveCwd: () => null });
    await store.addRule({ pattern: 'write', action: 'allow' }, 'session', 's1');
    store.clearSession('s1');
    expect(await store.collect('s1')).toEqual([]);
  });
});
