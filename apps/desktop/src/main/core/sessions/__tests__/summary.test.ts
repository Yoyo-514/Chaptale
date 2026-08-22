import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseSessionContent, readSessionFile } from '../reader';
import { deriveSessionSummary } from '../summary';

const goldenDir = path.join(__dirname, 'golden');

describe('deriveSessionSummary', () => {
  it('linear golden：名称/leaf/计数/预览/累计 token 与费用', async () => {
    const file = await readSessionFile(path.join(goldenDir, 'linear.jsonl'));
    const summary = deriveSessionSummary(file, path.join('sessions', 'global'), '/store/linear.jsonl');

    expect(summary).toMatchObject({
      id: 'golden-linear',
      cwd: '/workspace/story',
      createdAt: '2026-01-01T00:00:00.000Z',
      name: '雨夜开场',
      // 自然 leaf = 最后一条非 branch entry（s1，与 store 内存语义一致）。
      leafId: 's1',
      messageCount: 5,
      lastMessagePreview: '继续',
      totalTokens: 400,
      scope: 'global',
      path: '/store/linear.jsonl'
    });
    // updatedAt 取最后 entry 时间（s1）。
    expect(summary.updatedAt).toBe('2026-01-01T00:00:08.000Z');
  });

  it('branch golden：scope 按目录名判 workspace', async () => {
    const file = await readSessionFile(path.join(goldenDir, 'branch.jsonl'));
    const summary = deriveSessionSummary(file, path.join('sessions', 'Story-abc123'), '/store/branch.jsonl');

    expect(summary.scope).toBe('workspace');
    // 自然分支路径 m1→m5→m6 上的 message 数。
    expect(summary.messageCount).toBe(3);
    expect(summary.lastMessagePreview).toBe('就这个');
  });

  it('长预览截断到 80 字符', async () => {
    const file = await readSessionFile(path.join(goldenDir, 'linear.jsonl'));
    // 动态改最后一条 user 消息为长文本。
    file.entries.push({
      type: 'message',
      id: 'm-long',
      parentId: 'm5',
      timestamp: '2026-01-01T00:00:09.000Z',
      message: { role: 'user', content: '长'.repeat(200) }
    });

    const summary = deriveSessionSummary(file, path.join('sessions', 'global'), '/store/linear.jsonl');

    expect(summary.lastMessagePreview).toHaveLength(81);
    expect(summary.lastMessagePreview?.endsWith('…')).toBe(true);
  });

  it('空会话：计数 0、无预览、leaf null', () => {
    const summary = deriveSessionSummary(
      {
        header: {
          type: 'chaptale-session',
          version: 1,
          id: 'empty',
          timestamp: '2026-01-01T00:00:00.000Z',
          cwd: '/w'
        },
        entries: [],
        skippedMidLines: 0,
        skippedTailLines: 0
      },
      path.join('sessions', 'global'),
      '/store/empty.jsonl'
    );

    expect(summary.messageCount).toBe(0);
    expect(summary.leafId).toBeNull();
    expect(summary.lastMessagePreview).toBeUndefined();
    expect(summary.totalTokens).toBe(0);
  });

  it('中间坏行计入 damagedEntryCount；末行截断不计', () => {
    const header =
      '{"type":"chaptale-session","version":1,"id":"s1","timestamp":"2026-07-11T00:00:00.000Z","cwd":"/w"}';
    const intact =
      '{"type":"message","id":"m1","parentId":null,"timestamp":"2026-07-11T00:00:01.000Z","message":{"role":"user","content":"开头"}}';
    const halfWritten = '{"type":"message","id":"m2","paren';
    const dir = path.join('sessions', 'global');

    // 中间行坏：单写者 append-only 下写完的行不该再变，出现即意味着有外因动过文件。
    const damaged = deriveSessionSummary(
      parseSessionContent([header, halfWritten, intact].join('\n')),
      dir,
      '/store/damaged.jsonl'
    );

    expect(damaged.damagedEntryCount).toBe(1);

    // 末行写到一半：掉电留下的正常损耗，报出来只会让作者疑神疑鬼。
    const truncated = deriveSessionSummary(
      parseSessionContent([header, intact, halfWritten].join('\n')),
      dir,
      '/store/truncated.jsonl'
    );

    expect(truncated.damagedEntryCount).toBeUndefined();
  });
});
