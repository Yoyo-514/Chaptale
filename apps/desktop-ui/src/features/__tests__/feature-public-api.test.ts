import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// feature 必须有 index.ts 公共出口；外部只能引用 barrel，禁止深路径进入内部文件。
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

function extractImportSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\()\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
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

  it('跨 feature 相对导入只能指向目标公共出口', async () => {
    const files = await listSourceFiles(FEATURES_ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const owner = ownerFeature(file);
      if (!owner || file.includes(`${path.sep}__tests__${path.sep}`)) continue;

      for (const specifier of extractImportSpecifiers(await readFile(file, 'utf8'))) {
        if (!specifier.startsWith('.')) continue;
        const targetPath = path.resolve(path.dirname(file), specifier);
        const target = ownerFeature(targetPath);
        if (!target || target === owner) continue;

        const targetRoot = path.join(FEATURES_ROOT, target);
        if (targetPath !== targetRoot && targetPath !== path.join(targetRoot, 'index')) {
          violations.push(`${path.relative(SRC_ROOT, file)} -> ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
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
