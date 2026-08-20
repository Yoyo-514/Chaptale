import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseSessionContent, readSessionFile } from '../reader';
import { buildContextMessages, getPathToRoot, resolveLeafId } from '../replay';

const goldenDir = path.join(__dirname, 'golden');

async function loadGolden(name: string) {
  return readSessionFile(path.join(goldenDir, name));
}

describe('resolveLeafId', () => {
  it('无 branch_selected → 自然 leaf = 最后一条非 branch entry（含元数据）', async () => {
    const file = await loadGolden('linear.jsonl');

    // 与 SessionStore.append 内存 leaf 语义一致：s1（session_info）也是合法 leaf。
    expect(resolveLeafId(file.entries)).toBe('s1');
  });

  it('branch_selected(target) → 指定 leaf', async () => {
    const file = await loadGolden('branch.jsonl');

    // b1 切到 m1，随后 b2 切回 null；文件级解析应回自然 leaf m6。
    expect(resolveLeafId(file.entries)).toBe('m6');
  });
});

describe('getPathToRoot', () => {
  it('线性路径：根 → leaf 有序返回', async () => {
    const file = await loadGolden('linear.jsonl');
    const pathIds = getPathToRoot(file).map(entry => entry.id);

    expect(pathIds).toEqual(['m1', 'c1', 'm2', 'm3', 'm4', 'k1', 'm5', 's1']);
  });

  it('分支切换后路径沿新分支回溯（前缀共享）', async () => {
    const file = await loadGolden('branch.jsonl');

    // 显式回旧分支：b1 切到 m1，但文件最终自然 leaf 为 m6。
    expect(getPathToRoot(file).map(entry => entry.id)).toEqual(['m1', 'm5', 'm6']);

    // 指定旧 leaf：m4 路径保留原始线性前缀。
    expect(getPathToRoot(file, 'm4').map(entry => entry.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('悬空 leaf 回退自然 leaf', async () => {
    const file = await loadGolden('linear.jsonl');

    expect(getPathToRoot(file, 'ghost-id').map(entry => entry.id)).toEqual(getPathToRoot(file).map(entry => entry.id));
  });
});

describe('buildContextMessages', () => {
  it('无 compaction → 路径上 message 原样输出', async () => {
    const file = await loadGolden('branch.jsonl');
    const messages = buildContextMessages(file);

    // 自然分支路径 m1→m5→m6：user / assistant / user。
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[1]).toMatchObject({ role: 'assistant', content: '结局 C：开放式收尾。' });
  });

  it('compaction 生效：firstKeptEntryId 之前的 message 折叠为 user 摘要', async () => {
    const file = await loadGolden('linear.jsonl');
    const messages = buildContextMessages(file);

    // m1/m2/m3 折叠进 summary；保留 m4（含 usage）与 m5。
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: 'user', content: '用户询问第一章方向，助手建议雨夜开场并检索了场景写法。' });
    expect(messages[1]).toMatchObject({ role: 'assistant', content: expect.stringContaining('综合检索结果') });
    expect(messages[2]).toEqual({ role: 'user', content: '继续' });
  });

  it('多次 compaction → 最后一条生效', async () => {
    const raw = [
      '{"type":"chaptale-session","version":1,"id":"t","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/w"}',
      '{"type":"message","id":"m1","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":"one"}}',
      '{"type":"compaction","id":"k1","parentId":"m1","timestamp":"2026-01-01T00:00:02.000Z","summary":"第一次摘要","firstKeptEntryId":"m2","tokensBefore":100}',
      '{"type":"message","id":"m2","parentId":"k1","timestamp":"2026-01-01T00:00:03.000Z","message":{"role":"user","content":"two"}}',
      '{"type":"compaction","id":"k2","parentId":"m2","timestamp":"2026-01-01T00:00:04.000Z","summary":"第二次摘要（涵盖一切）","firstKeptEntryId":"m2","tokensBefore":200}',
      '{"type":"message","id":"m3","parentId":"k2","timestamp":"2026-01-01T00:00:05.000Z","message":{"role":"user","content":"three"}}'
    ].join('\n');

    const file = parseSessionContent(raw);
    const messages = buildContextMessages(file);

    expect(messages).toEqual([
      { role: 'user', content: '第二次摘要（涵盖一切）' },
      { role: 'user', content: 'two' },
      { role: 'user', content: 'three' }
    ]);
  });

  it('compaction 悬空 firstKeptEntryId → 折叠该 compaction 之前的全部 message', async () => {
    const raw = [
      '{"type":"chaptale-session","version":1,"id":"t","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/w"}',
      '{"type":"message","id":"m1","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":"one"}}',
      '{"type":"message","id":"m2","parentId":"m1","timestamp":"2026-01-01T00:00:02.000Z","message":{"role":"user","content":"two"}}',
      '{"type":"compaction","id":"k1","parentId":"m2","timestamp":"2026-01-01T00:00:03.000Z","summary":"悬空摘要","firstKeptEntryId":"ghost","tokensBefore":100}',
      '{"type":"message","id":"m3","parentId":"k1","timestamp":"2026-01-01T00:00:04.000Z","message":{"role":"user","content":"three"}}'
    ].join('\n');

    const file = parseSessionContent(raw);

    expect(buildContextMessages(file)).toEqual([
      { role: 'user', content: '悬空摘要' },
      { role: 'user', content: 'three' }
    ]);
  });
});
