import type { ToolCallEvent, ToolCallEventResult } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';

import type { SessionCtx } from '../../../../core/session-ctx/types';
import { createPermissionGateExtension } from '../gate-extension';

type GateHandler = (event: ToolCallEvent) => Promise<ToolCallEventResult | void>;

const SESSION_CTX: SessionCtx = { sessionId: 's1', cwd: '/workspace-a', scope: 'workspace' };

async function setupGate(overrides: {
  ctx?: SessionCtx;
  rules?: unknown[];
  interactive?: boolean;
  askResult?: unknown;
  customRiskLevels?: Record<string, 'readonly' | 'mutating' | 'destructive'>;
}) {
  const ask = vi.fn(async () => overrides.askResult ?? { outcome: 'allow-once' });
  const collect = vi.fn(async () => overrides.rules ?? []);
  const extension = createPermissionGateExtension({
    ctx: overrides.ctx ?? SESSION_CTX,
    broker: { ask } as never,
    ruleStore: { collect } as never,
    customRiskLevels: overrides.customRiskLevels ?? {},
    interactive: overrides.interactive ?? true
  });

  let handler: GateHandler | undefined;
  const fakePi = { on: (event: string, fn: GateHandler) => (handler = event === 'tool_call' ? fn : handler) };
  await (extension as { factory: (pi: unknown) => void }).factory(fakePi);

  if (!handler) {
    throw new Error('tool_call handler 未注册');
  }

  return { handler, ask, collect };
}

function toolCall(toolName: string, input: Record<string, unknown> = {}): ToolCallEvent {
  return { type: 'tool_call', toolName, toolCallId: 'c1', input } as unknown as ToolCallEvent;
}

describe('createPermissionGateExtension', () => {
  it('passes the session context to rule collection', async () => {
    const { handler, collect } = await setupGate({});

    await handler(toolCall('read', { path: 'a.md' }));

    expect(collect).toHaveBeenCalledWith({ sessionId: 's1', cwd: '/workspace-a', scope: 'workspace' });
  });

  it('passes readonly builtin tools without asking', async () => {
    const { handler, ask } = await setupGate({});
    await expect(handler(toolCall('read', { path: 'a.md' }))).resolves.toBeUndefined();
    expect(ask).not.toHaveBeenCalled();
  });

  it('blocks on deny rules with a policy reason', async () => {
    const { handler, ask } = await setupGate({ rules: [{ pattern: 'bash(rm *)', action: 'deny' }] });
    const result = await handler(toolCall('bash', { command: 'rm -rf dist' }));
    expect(result).toMatchObject({ block: true });
    expect((result as { reason: string }).reason).toContain('权限策略拒绝');
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks for mutating tools with ctx and forwards the user deny reason to the model', async () => {
    const { handler, ask } = await setupGate({ askResult: { outcome: 'deny', reason: '路径不对' } });
    const result = await handler(toolCall('write', { path: 'a.md' }));
    expect(ask).toHaveBeenCalledWith({
      ctx: SESSION_CTX,
      toolName: 'write',
      riskLevel: 'mutating',
      subject: 'a.md'
    });
    expect(result).toMatchObject({ block: true, reason: '用户拒绝了此操作：路径不对' });
  });

  it('passes when the user allows', async () => {
    const { handler } = await setupGate({ askResult: { outcome: 'allow-once' } });
    await expect(handler(toolCall('edit', { path: 'a.md' }))).resolves.toBeUndefined();
  });

  it('denies ask outcomes in non-interactive sessions without hanging', async () => {
    const { handler, ask } = await setupGate({ interactive: false });
    const result = await handler(toolCall('write', { path: 'a.md' }));
    expect(result).toMatchObject({ block: true });
    expect(ask).not.toHaveBeenCalled();
  });

  it('uses declared custom risk levels and defaults unknown tools to mutating', async () => {
    const { handler, ask } = await setupGate({ customRiskLevels: { todo_write: 'readonly' } });
    await expect(handler(toolCall('todo_write'))).resolves.toBeUndefined();

    await handler(toolCall('mystery_tool'));
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'mystery_tool', riskLevel: 'mutating' }));
  });
});
