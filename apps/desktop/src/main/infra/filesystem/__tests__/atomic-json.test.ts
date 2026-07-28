import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeJsonAtomically } from '../atomic-json';

describe('writeJsonAtomically', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-atomic-json-'));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('writes formatted JSON through a same-directory temporary file and leaves no tmp files', async () => {
    const filePath = path.join(cwd, 'nested', 'value.json');

    await writeJsonAtomically(filePath, { ok: true, text: '原子写入' });

    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe('{\n  "ok": true,\n  "text": "原子写入"\n}\n');
    const files = await fs.readdir(path.dirname(filePath));
    expect(files.filter(file => file.endsWith('.tmp'))).toEqual([]);
  });

  it('rejects values that JSON.stringify cannot represent instead of writing invalid JSON', async () => {
    const filePath = path.join(cwd, 'invalid.json');

    await expect(writeJsonAtomically(filePath, undefined)).rejects.toThrow('无法序列化为 JSON');
    await expect(fs.readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('serializes concurrent writes to the same path in call order', async () => {
    const filePath = path.join(cwd, 'value.json');

    await Promise.all(Array.from({ length: 20 }, (_, index) => writeJsonAtomically(filePath, { index })));

    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe('{\n  "index": 19\n}\n');
    const files = await fs.readdir(cwd);
    expect(files.filter(file => file.includes('.tmp'))).toEqual([]);
  });
});
