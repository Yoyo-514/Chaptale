import { describe, expect, it, vi } from 'vitest';

import type { PermissionDecision } from '@chaptale/shared';

import type { SessionCtx } from '../../../core/session-ctx/types';
import type { PermissionRule } from '../../permissions/protocol';
import { createBrokerPermissionGate, toPermissionSubject } from '../chat-bundle';

const CTX: SessionCtx = { sessionId: 's1', cwd: '/works/novel' };

function createGate(rules: PermissionRule[], decision: PermissionDecision = { outcome: 'allow-once' }) {
  const ask = vi.fn(async () => decision);
  const collect = vi.fn(async () => rules);
  const gate = createBrokerPermissionGate({ broker: { ask }, ruleStore: { collect }, ctx: CTX });

  return { gate, ask, collect };
}

function check(gate: ReturnType<typeof createGate>['gate'], overrides: Partial<Parameters<typeof gate.check>[0]> = {}) {
  return gate.check({
    sessionId: 's1',
    toolName: 'write',
    riskLevel: 'mutating',
    args: { path: '小说/第一章.md', content: '正文' },
    ...overrides
  });
}

describe('createBrokerPermissionGate 规则前置', () => {
  it('命中 allow 规则时直行，不再弹授权卡片', async () => {
    // 闸门不读规则库的话，「本作品始终允许」落库后依然每次弹卡。
    const { gate, ask } = createGate([{ pattern: 'write', action: 'allow' }]);

    await expect(check(gate)).resolves.toEqual({ outcome: 'allow-once' });
    expect(ask).not.toHaveBeenCalled();
  });

  it('命中 deny 规则时直接拒绝，不弹卡', async () => {
    const { gate, ask } = createGate([{ pattern: 'write', action: 'deny' }]);

    await expect(check(gate)).resolves.toMatchObject({ outcome: 'deny' });
    expect(ask).not.toHaveBeenCalled();
  });

  it('无规则命中的 mutating 才走 broker，且带发起会话的 cwd', async () => {
    const { gate, ask, collect } = createGate([]);

    await expect(check(gate)).resolves.toEqual({ outcome: 'allow-once' });
    expect(collect).toHaveBeenCalledWith(CTX);
    // 回归：cwd 曾被硬编码为空串，workspace 级规则因此既读不到也写不进。
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ ctx: CTX, toolName: 'write' }));
  });

  it('destructive 无规则时按分级默认拒绝，不弹卡', async () => {
    const { gate, ask } = createGate([]);

    await expect(check(gate, { riskLevel: 'destructive' })).resolves.toMatchObject({ outcome: 'deny' });
    expect(ask).not.toHaveBeenCalled();
  });

  it('用户拒绝时透传拒绝理由', async () => {
    const { gate } = createGate([], { outcome: 'deny', reason: '这章不要动' });

    await expect(check(gate)).resolves.toEqual({ outcome: 'deny', reason: '这章不要动' });
  });

  it('参数级规则按主参数摘要匹配', async () => {
    const { gate, ask } = createGate([{ pattern: 'write(小说/*)', action: 'allow' }]);

    await expect(check(gate)).resolves.toEqual({ outcome: 'allow-once' });
    expect(ask).not.toHaveBeenCalled();

    // 同一工具、不同路径不被这条规则覆盖。
    const outside = createGate([{ pattern: 'write(小说/*)', action: 'allow' }]);
    await check(outside.gate, { args: { path: '设定/世界观.md' } });
    expect(outside.ask).toHaveBeenCalled();
  });
});

describe('createBrokerPermissionGate 作品外访问', () => {
  it('按工具给出的真实路径摘要匹配，规则只取会话与全局层（作品层放行不生效）', async () => {
    const { gate, ask, collect } = createGate([{ pattern: 'external_read(E:/资料/*)', action: 'allow' }]);

    await expect(
      check(gate, {
        toolName: 'external_read',
        riskLevel: 'sensitive',
        subject: 'E:/资料/设定.md',
        // 模型写的是相对写法；匹配必须用工具解析后的真实路径，否则同一目录换个写法就对不上。
        args: { path: '../../资料/设定.md' }
      })
    ).resolves.toEqual({ outcome: 'allow-once' });
    expect(collect).toHaveBeenCalledWith(CTX, { workspaceAllows: false });
    expect(ask).not.toHaveBeenCalled();
  });

  it('sensitive 无规则时询问宿主会话，并注明代为请求的子任务', async () => {
    const ask = vi.fn(async () => ({ outcome: 'allow-once' as const }));
    const gate = createBrokerPermissionGate({
      broker: { ask },
      ruleStore: { collect: vi.fn(async () => []) },
      ctx: CTX,
      requester: '资料专员'
    });

    await gate.check({
      sessionId: 'task-1',
      toolName: 'external_read',
      riskLevel: 'sensitive',
      subject: 'E:/资料/a.md',
      args: { path: 'E:/资料/a.md' }
    });

    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: CTX,
        toolName: 'external_read',
        riskLevel: 'sensitive',
        subject: 'E:/资料/a.md',
        requester: '资料专员'
      })
    );
  });
});

describe('toPermissionSubject', () => {
  it('取工具主参数而非整包 JSON（整包 JSON 让参数级规则永远匹配不上）', () => {
    expect(toPermissionSubject({ path: 'a.md', content: '很长的正文' })).toBe('a.md');
    expect(toPermissionSubject({ url: 'https://example.com/x' })).toBe('https://example.com/x');
    expect(toPermissionSubject({ query: '搜索词' })).toBe('搜索词');
  });

  it('无可识别主参数时兜底截断 JSON', () => {
    expect(toPermissionSubject({ foo: 1 })).toBe('{"foo":1}');
  });

  it('主参数为空串时继续向后探测', () => {
    expect(toPermissionSubject({ path: '   ', url: 'https://example.com' })).toBe('https://example.com');
  });
});
