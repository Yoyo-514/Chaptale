import { describe, expect, it } from 'vitest';

import { defaultKeepRecentTokens, resolveCompactionCutPoint } from '../compaction-cut';
import type { SessionMessage, SessionMessageEntry } from '../entry';

/**
 * 压缩切点。
 *
 * 修复前 `firstKeptEntryId` 直接取压缩时刻的 leaf，保留区间退化成 1——
 * 压缩后上下文只剩 `[摘要, 最后一条消息]`，近期原文全部丢弃。
 */

let seq = 0;

function entry(message: SessionMessage): SessionMessageEntry {
  seq += 1;

  return { type: 'message', id: `e${seq}`, parentId: null, timestamp: '2026-08-20T00:00:00.000Z', message };
}

const user = (text: string) => entry({ role: 'user', content: text });
const assistant = (text: string) => entry({ role: 'assistant', content: text });
const assistantCalling = (id: string) =>
  entry({ role: 'assistant', content: '查一下', toolCalls: [{ id, name: 'read', arguments: {} }] });
const toolResult = (id: string) => entry({ role: 'tool', toolCallId: id, toolName: 'read', output: '结果' });

describe('resolveCompactionCutPoint', () => {
  it('预算内的近期原文全部保留，不再退化成一条', () => {
    // 每条约 100 token 正文；预算 350 → 大致保留最后 3 条。
    const entries = Array.from({ length: 10 }, (_, index) => assistant(`第${index}段`.padEnd(100, '文')));

    const cut = resolveCompactionCutPoint(entries, 350);

    expect(cut).toBeDefined();
    expect(cut!.foldedCount).toBeGreaterThan(5);
    // 关键：保留的不止一条。
    expect(entries.length - cut!.foldedCount).toBeGreaterThan(1);
  });

  it('切点不落在 tool 结果上：会前移到声明它的 assistant', () => {
    const entries = [
      user('开始'),
      assistant('一'.repeat(200)),
      assistantCalling('call_1'),
      toolResult('call_1'),
      assistant('收尾')
    ];

    // 预算刚好会把切点算到 tool 结果那条上。
    const cut = resolveCompactionCutPoint(entries, 30);

    expect(cut).toBeDefined();
    // 若切在 tool 上，这条结果会成为孤儿并在读取侧被丢弃——静默吃掉工具产出。
    expect(entries[cut!.foldedCount]!.message.role).not.toBe('tool');
  });

  it('全部都在预算内时退回"只保留最后一轮"，让手动压缩总能生效', () => {
    const entries = [user('甲'), assistant('乙'), user('丙'), assistant('丁')];

    const cut = resolveCompactionCutPoint(entries, 1_000_000);

    expect(cut).toMatchObject({ foldedCount: 2 });
    expect(entries[cut!.foldedCount]!.message).toMatchObject({ role: 'user', content: '丙' });
  });

  it('内容不足以折叠时返回 undefined，而不是折出一个空摘要', () => {
    expect(resolveCompactionCutPoint([], 1000)).toBeUndefined();
    expect(resolveCompactionCutPoint([user('只有一条')], 1000)).toBeUndefined();
  });

  it('保留区间首条即 firstKeptEntryId', () => {
    const entries = [user('甲'), assistant('乙'), user('丙'), assistant('丁')];

    const cut = resolveCompactionCutPoint(entries, 1_000_000)!;

    expect(cut.firstKeptEntryId).toBe(entries[cut.foldedCount]!.id);
  });
});

describe('defaultKeepRecentTokens', () => {
  it('大窗口封顶 20k', () => {
    expect(defaultKeepRecentTokens(200_000)).toBe(20_000);
  });

  it('小窗口按比例收缩，预算不会大于窗口', () => {
    expect(defaultKeepRecentTokens(8_000)).toBe(2_000);
  });

  it('窗口未知时给出保守默认', () => {
    expect(defaultKeepRecentTokens(0)).toBe(20_000);
  });
});
