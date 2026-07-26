import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// 最小守卫（S1）：feature 必须有 index.ts 公共出口；外部只准 import barrel，
// 禁止深路径进入 feature 内部文件。完整依赖白名单守卫在 S4 落地。
const SRC_ROOT = path.resolve(import.meta.dirname, '../..');
const FEATURES_ROOT = path.join(SRC_ROOT, 'features');

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(fullPath)));
    } else if (/\.(ts|vue)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function listFeatureNames(): Promise<string[]> {
  const entries = await readdir(FEATURES_ROOT, { withFileTypes: true });

  return entries.filter(entry => entry.isDirectory() && entry.name !== '__tests__').map(entry => entry.name);
}

function ownerFeature(filePath: string): string | null {
  const relative = path.relative(FEATURES_ROOT, filePath);

  if (relative.startsWith('..')) return null;

  return relative.split(path.sep)[0] ?? null;
}

describe('feature 公共 API 守卫', () => {
  it('每个 feature 都有 index.ts 公共出口', async () => {
    const names = await listFeatureNames();
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const indexStat = await stat(path.join(FEATURES_ROOT, name, 'index.ts'));
      expect(indexStat.isFile()).toBe(true);
    }
  });

  it('feature 外部不得深路径 import feature 内部文件', async () => {
    const names = await listFeatureNames();
    expect(names.length).toBeGreaterThan(0);

    const files = await listSourceFiles(SRC_ROOT);
    const deepImport = /from\s+['"](?:@\/|(?:\.\.\/)+)features\/([\w-]+)\/[^'"]+['"]/g;
    const violations: string[] = [];

    for (const file of files) {
      const owner = ownerFeature(file);
      const content = await readFile(file, 'utf8');

      for (const match of content.matchAll(deepImport)) {
        if (match[1] !== owner) {
          violations.push(`${path.relative(SRC_ROOT, file)} -> ${match[0]}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
