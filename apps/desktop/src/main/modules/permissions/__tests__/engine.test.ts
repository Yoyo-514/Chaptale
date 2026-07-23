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
    expect(evaluatePermission(request({ riskLevel: 'mutating' }), [])).toBe('ask');
    expect(evaluatePermission(request({ riskLevel: 'destructive' }), [])).toBe('deny');
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
