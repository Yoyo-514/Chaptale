import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseSessionContent, readSessionFile } from '../reader';

const goldenDir = path.join(__dirname, 'golden');

async function readGolden(name: string) {
  return readSessionFile(path.join(goldenDir, name));
}

describe('readSessionFile 容错', () => {
  it('解析 golden linear 文件（header + 8 entries）', async () => {
    const file = await readGolden('linear.jsonl');

    expect(file.header).toEqual({
      type: 'chaptale-session',
      version: 1,
      id: 'golden-linear',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: '/workspace/story'
    });
    expect(file.entries).toHaveLength(8);
    expect(file.skippedMidLines).toBe(0);
    expect(file.skippedTailLines).toBe(0);
  });

  it('最后一行截断 → 跳过并计数', () => {
    const raw = [
      '{"type":"chaptale-session","version":1,"id":"t","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/w"}',
      '{"type":"message","id":"m1","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":"hi"}}',
      '{"type":"message","id":"m2","parentId":"m1","timestamp":"2026-01-01T00:00:0'
    ].join('\n');

    const file = parseSessionContent(raw);

    expect(file.entries).toHaveLength(1);
    expect(file.skippedTailLines).toBe(1);
    expect(file.skippedMidLines).toBe(0);
  });

  it('中间坏行 → 跳过并计数，不阻塞后续解析', () => {
    const raw = [
      '{"type":"chaptale-session","version":1,"id":"t","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/w"}',
      '坏行{{{',
      '{"type":"message","id":"m1","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":"hi"}}'
    ].join('\n');

    const file = parseSessionContent(raw);

    expect(file.entries).toHaveLength(1);
    expect(file.entries[0]?.id).toBe('m1');
    expect(file.skippedMidLines).toBe(1);
    expect(file.skippedTailLines).toBe(0);
  });

  it('缺 id 的 entry 行视为坏行', () => {
    const raw = [
      '{"type":"chaptale-session","version":1,"id":"t","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/w"}',
      '{"type":"message","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":"bad"}}',
      '{"type":"message","id":"m1","parentId":null,"timestamp":"2026-01-01T00:00:02.000Z","message":{"role":"user","content":"hi"}}'
    ].join('\n');

    const file = parseSessionContent(raw);

    expect(file.entries).toHaveLength(1);
    expect(file.entries[0]?.id).toBe('m1');
    expect(file.skippedMidLines).toBe(1);
  });

  it('只有 header 的空会话 → entries 为空、leaf 为 null', () => {
    const file = parseSessionContent(
      '{"type":"chaptale-session","version":1,"id":"t","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/w"}\n'
    );

    expect(file.entries).toEqual([]);
    expect(file.skippedMidLines).toBe(0);
    expect(file.skippedTailLines).toBe(0);
  });

  it('空文件 / 无 header → throw（调用方按非会话文件处理）', () => {
    expect(() => parseSessionContent('')).toThrow();
    expect(() => parseSessionContent('{}\n')).toThrow();
    expect(() =>
      parseSessionContent('{"type":"other","version":1,"id":"t","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/w"}\n')
    ).toThrow();
  });

  it('CRLF 行尾兼容', () => {
    const raw = [
      '{"type":"chaptale-session","version":1,"id":"t","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/w"}',
      '{"type":"message","id":"m1","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":"hi"}}'
    ].join('\r\n');

    const file = parseSessionContent(raw);

    expect(file.entries).toHaveLength(1);
    expect(file.skippedMidLines + file.skippedTailLines).toBe(0);
  });
});

describe('golden 文件字节形状', () => {
  it('每行均为合法 JSON 且以换行结尾', async () => {
    for (const name of ['linear.jsonl', 'branch.jsonl']) {
      const raw = await readFile(path.join(goldenDir, name), 'utf8');

      expect(raw.endsWith('\n')).toBe(true);

      for (const line of raw.split('\n').filter(Boolean)) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    }
  });
});
