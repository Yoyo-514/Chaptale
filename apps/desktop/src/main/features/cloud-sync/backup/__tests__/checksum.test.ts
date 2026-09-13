import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checksum, checksumFile } from '../checksum';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-checksum-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('内容指纹', () => {
  it('同样的字节得到同样的指纹，差一个字节就不同', () => {
    const encoder = new TextEncoder();

    // 固定期望值：指纹要跨进程、跨版本稳定，否则“两边一致”会变成随机结论。
    expect(checksum(encoder.encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(checksum(encoder.encode('abc'))).toBe(checksum(encoder.encode('abc')));
    expect(checksum(encoder.encode('abd'))).not.toBe(checksum(encoder.encode('abc')));
  });
  it('按文件算的指纹与按内存算的一致', async () => {
    const file = path.join(dir, '正文.md');

    await writeFile(file, '第一章\n');

    expect(await checksumFile(file)).toBe(checksum(new TextEncoder().encode('第一章\n')));
  });
});
