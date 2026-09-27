import { describe, expect, it } from 'vitest';

import { evaluatePermission, ruleMatches } from '../engine';
import type { PermissionRequest, PermissionRule } from '../protocol';

function request(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return { toolName: 'write', riskLevel: 'mutating', ...overrides };
}

describe('ruleMatches', () => {
  it('matches bare tool name patterns against any invocation', () => {
    expect(ruleMatches({ pattern: 'write', action: 'allow' }, request({ subject: 'a.md' }))).toBe(true);
    expect(ruleMatches({ pattern: 'write', action: 'allow' }, request({ toolName: 'edit' }))).toBe(false);
  });

  it('matches subject prefixes with trailing wildcard', () => {
    const rule: PermissionRule = { pattern: 'bash(git *)', action: 'allow' };
    expect(ruleMatches(rule, request({ toolName: 'bash', subject: 'git status' }))).toBe(true);
    expect(ruleMatches(rule, request({ toolName: 'bash', subject: 'rm -rf /' }))).toBe(false);
  });

  it('matches exact subjects without wildcard', () => {
    const rule: PermissionRule = { pattern: 'write(notes.md)', action: 'allow' };
    expect(ruleMatches(rule, request({ subject: 'notes.md' }))).toBe(true);
    expect(ruleMatches(rule, request({ subject: 'notes.md.bak' }))).toBe(false);
    expect(ruleMatches(rule, request({ subject: undefined }))).toBe(false);
  });
});

describe('evaluatePermission', () => {
  it('falls back to risk-level defaults when no rule matches', () => {
    expect(evaluatePermission(request({ riskLevel: 'readonly' }), [])).toBe('allow');
    expect(evaluatePermission(request({ riskLevel: 'sensitive' }), [])).toBe('ask');
    expect(evaluatePermission(request({ riskLevel: 'mutating' }), [])).toBe('ask');
    expect(evaluatePermission(request({ riskLevel: 'destructive' }), [])).toBe('deny');
  });

  it('scopes external directory grants by real-path prefix without leaking to sibling directories', () => {
    const rules: PermissionRule[] = [{ pattern: 'external_read(E:/资料/*)', action: 'allow' }];
    const external = (subject: string) =>
      evaluatePermission(request({ toolName: 'external_read', riskLevel: 'sensitive', subject }), rules);

    expect(external('E:/资料/')).toBe('allow');
    expect(external('E:/资料/设定/世界观.md')).toBe('allow');
    expect(external('E:/资料备份/世界观.md')).toBe('ask');
    // 同一目录的读取放行不等于写入放行。
    expect(
      evaluatePermission(request({ toolName: 'external_write', riskLevel: 'mutating', subject: 'E:/资料/a.md' }), rules)
    ).toBe('ask');
  });

  it('takes the most conservative action across matching rules', () => {
    const rules: PermissionRule[] = [
      { pattern: 'write', action: 'allow' },
      { pattern: 'write(secrets*)', action: 'deny' }
    ];
    expect(evaluatePermission(request({ subject: 'notes.md' }), rules)).toBe('allow');
    expect(evaluatePermission(request({ subject: 'secrets/key.txt' }), rules)).toBe('deny');
  });

  it('lets explicit rules override risk defaults in both directions', () => {
    expect(evaluatePermission(request({ riskLevel: 'destructive' }), [{ pattern: 'write', action: 'allow' }])).toBe(
      'allow'
    );
    expect(evaluatePermission(request({ riskLevel: 'readonly' }), [{ pattern: 'write', action: 'deny' }])).toBe('deny');
  });
});
