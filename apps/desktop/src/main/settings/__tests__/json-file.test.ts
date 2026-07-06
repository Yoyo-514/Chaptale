import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readJsonFile, writeJsonFile } from '../json-file';

let tempDir = '';

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-json-file-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('json-file', () => {
  it('returns undefined for missing, empty, and malformed files', async () => {
    expect(await readJsonFile(path.join(tempDir, 'missing.json'))).toBeUndefined();

    const emptyPath = path.join(tempDir, 'empty.json');
    await writeFile(emptyPath, '   ', 'utf8');
    expect(await readJsonFile(emptyPath)).toBeUndefined();

    const malformedPath = path.join(tempDir, 'malformed.json');
    await writeFile(malformedPath, '{ nope', 'utf8');
    expect(await readJsonFile(malformedPath)).toBeUndefined();
  });

  it('writes formatted JSON atomically into missing parent directories', async () => {
    const filePath = path.join(tempDir, 'nested', 'settings.json');

    await writeJsonFile(filePath, { enabled: true, nested: { count: 1 } });

    expect(await readJsonFile(filePath)).toEqual({ enabled: true, nested: { count: 1 } });
    expect(await readFile(filePath, 'utf8')).toBe('{\n  "enabled": true,\n  "nested": {\n    "count": 1\n  }\n}\n');
  });
});
