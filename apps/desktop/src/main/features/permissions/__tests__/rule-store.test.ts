import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { SessionCtx } from '../../../core/session-ctx/types';
import { PermissionRuleStore } from '../rule-store';

const tempDirs: string[] = [];

function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaptale-permissions-'));
  tempDirs.push(dir);
  return dir;
}

function ctx(sessionId: string, cwd: string): SessionCtx {
  return { sessionId, cwd };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('PermissionRuleStore', () => {
  it('merges session, workspace and global layers from the explicit session context', async () => {
    const globalDir = createTempDir();
    const cwd = createTempDir();
    const store = new PermissionRuleStore({ globalDir });
    const sessionCtx = ctx('s1', cwd);

    await store.addRule({ pattern: 'bash(git *)', action: 'allow' }, 'session', sessionCtx);
    await store.addRule({ pattern: 'write', action: 'allow' }, 'workspace', sessionCtx);
    await store.addRule({ pattern: 'bash(rm *)', action: 'deny' }, 'global', sessionCtx);

    expect((await store.collect(sessionCtx)).map(rule => rule.pattern)).toEqual(['bash(git *)', 'write', 'bash(rm *)']);
    // 其他会话看不到 s1 的会话级规则。
    expect((await store.collect(ctx('s2', cwd))).map(rule => rule.pattern)).toEqual(['write', 'bash(rm *)']);
  });

  it('collects workspace rules from the calling session cwd instead of the UI workspace', async () => {
    const globalDir = createTempDir();
    const workspaceA = createTempDir();
    const workspaceB = createTempDir();
    const store = new PermissionRuleStore({ globalDir });

    await store.addRule({ pattern: 'write(a.md)', action: 'allow' }, 'workspace', ctx('session-a', workspaceA));
    await store.addRule({ pattern: 'write(b.md)', action: 'deny' }, 'workspace', ctx('session-b', workspaceB));

    const rules = await store.collect({ sessionId: 'session-a', cwd: workspaceA });

    expect(rules).toEqual([{ pattern: 'write(a.md)', action: 'allow' }]);
  });

  it('persists workspace rules across store instances and appends on repeat', async () => {
    const globalDir = createTempDir();
    const cwd = createTempDir();
    const sessionCtx = ctx('s1', cwd);
    await new PermissionRuleStore({ globalDir }).addRule({ pattern: 'edit', action: 'allow' }, 'workspace', sessionCtx);

    const reloaded = new PermissionRuleStore({ globalDir });
    await reloaded.addRule({ pattern: 'write', action: 'allow' }, 'workspace', sessionCtx);

    expect((await reloaded.collect(sessionCtx)).map(rule => rule.pattern)).toEqual(['edit', 'write']);
  });

  it('lists persistent rules by explicit cwd and removes all exact duplicates from one scope', async () => {
    const globalDir = createTempDir();
    const cwd = createTempDir();
    const sessionCtx = ctx('s1', cwd);
    const store = new PermissionRuleStore({ globalDir });

    await store.addRule({ pattern: 'write(src/example.ts)', action: 'allow' }, 'workspace', sessionCtx);
    await store.addRule({ pattern: 'write(src/example.ts)', action: 'allow' }, 'workspace', sessionCtx);
    await store.addRule({ pattern: 'write(src/example.ts)', action: 'allow' }, 'global', sessionCtx);
    await store.addRule({ pattern: 'bash(rm *)', action: 'deny' }, 'global', sessionCtx);

    expect(await store.listPersistentRules(cwd)).toEqual({
      workspace: [
        { pattern: 'write(src/example.ts)', action: 'allow' },
        { pattern: 'write(src/example.ts)', action: 'allow' }
      ],
      global: [
        { pattern: 'write(src/example.ts)', action: 'allow' },
        { pattern: 'bash(rm *)', action: 'deny' }
      ]
    });

    await store.removePersistentRule({ pattern: 'write(src/example.ts)', action: 'allow' }, 'workspace', cwd);

    expect(await store.listPersistentRules(cwd)).toEqual({
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

    const store = new PermissionRuleStore({ globalDir });
    expect(await store.collect(ctx('s1', cwd))).toEqual([{ pattern: 'read', action: 'allow' }]);
  });

  it('rejects workspace writes without an explicit cwd and session writes without a session id', async () => {
    const store = new PermissionRuleStore({ globalDir: createTempDir() });
    await expect(
      store.addRule({ pattern: 'write', action: 'allow' }, 'workspace', {
        sessionId: 's1',
        cwd: ''
      })
    ).rejects.toThrow();
    await expect(
      store.addRule({ pattern: 'write', action: 'allow' }, 'session', {
        sessionId: '',
        cwd: createTempDir()
      })
    ).rejects.toThrow();
  });

  it('clears session rules on release', async () => {
    const store = new PermissionRuleStore({ globalDir: createTempDir() });
    const sessionCtx = ctx('s1', createTempDir());
    await store.addRule({ pattern: 'write', action: 'allow' }, 'session', sessionCtx);
    store.clearSession('s1');
    expect(await store.collect(sessionCtx)).toEqual([]);
  });

  it('drops workspace allow rules on request while keeping workspace denials and the other layers', async () => {
    const globalDir = createTempDir();
    const cwd = createTempDir();
    const store = new PermissionRuleStore({ globalDir });
    const sessionCtx = ctx('s1', cwd);

    // 作品文件随分享流转：它夹带的作品外放行不能生效，但它的拒绝仍然要算数。
    await store.addRule({ pattern: 'external_read(C:/*)', action: 'allow' }, 'workspace', sessionCtx);
    await store.addRule({ pattern: 'external_read(C:/私密/*)', action: 'deny' }, 'workspace', sessionCtx);
    await store.addRule({ pattern: 'external_read(D:/资料/*)', action: 'allow' }, 'session', sessionCtx);
    await store.addPersistentRule({ pattern: 'external_read(E:/资料/*)', action: 'allow' }, 'global', null);

    expect((await store.collect(sessionCtx, { workspaceAllows: false })).map(rule => rule.pattern)).toEqual([
      'external_read(D:/资料/*)',
      'external_read(C:/私密/*)',
      'external_read(E:/资料/*)'
    ]);
    expect(await store.collect(sessionCtx)).toHaveLength(4);
  });

  it('adds persistent rules without a session context and rejects workspace writes without a cwd', async () => {
    const globalDir = createTempDir();
    const store = new PermissionRuleStore({ globalDir });

    await store.addPersistentRule({ pattern: 'external_write(E:/导出/*)', action: 'allow' }, 'global', null);

    expect((await store.listPersistentRules(null)).global).toEqual([
      { pattern: 'external_write(E:/导出/*)', action: 'allow' }
    ]);
    await expect(store.addPersistentRule({ pattern: 'write', action: 'allow' }, 'workspace', null)).rejects.toThrow();
  });
});
