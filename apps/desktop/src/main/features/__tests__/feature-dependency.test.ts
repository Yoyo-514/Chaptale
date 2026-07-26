import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const mainRoot = path.resolve(import.meta.dirname, '../..');
const featuresRoot = path.join(mainRoot, 'features');

/**
 * Main 跨 feature 依赖白名单（边级精确登记，`from -> to/落点文件`）。
 *
 * 约束：
 * - 新增跨 feature 导入必须在此显式登记并通过评审；陈旧条目同样报错；
 * - 所有边必须保持无运行时环：当前唯一反向运行时边是 search -> memory/paths，
 *   memory -> personas 与 personas -> search 均为 type-only，不构成运行时环。
 */
const crossFeatureAllowlist = [
  'commands -> skills/provider',
  'memory -> personas/registry',
  'personas -> search/types',
  'prompts -> personas/builtin',
  'search -> memory/paths',
  'subagent -> personas/registry',
  'subagent -> tasks/runner-port',
  'tasks -> personas/registry',
  'tasks -> personas/task-spec',
  'tasks -> runs/record',
  'tasks -> runs/store'
] as const;

describe('Main 跨 feature 依赖白名单', () => {
  it('features 生产代码的跨 feature 导入与白名单精确一致', async () => {
    const edges = await collectCrossFeatureEdges();

    expect(edges).toEqual([...crossFeatureAllowlist].toSorted());
  });

  it('features 生产代码不导入 app 层', async () => {
    const files = await collectProductionFiles(featuresRoot);
    const violations: string[] = [];
    for (const file of files) {
      for (const specifier of extractRelativeImports(await fs.readFile(file, 'utf8'))) {
        const resolved = path.resolve(path.dirname(file), stripQuery(specifier));
        if (isInside(resolved, path.join(mainRoot, 'app'))) {
          violations.push(`${toPosix(path.relative(mainRoot, file))}::${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

async function collectCrossFeatureEdges(): Promise<string[]> {
  const featureNames = new Set(
    (await fs.readdir(featuresRoot, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name)
  );
  const edges = new Set<string>();
  for (const feature of featureNames) {
    for (const file of await collectProductionFiles(path.join(featuresRoot, feature))) {
      for (const specifier of extractRelativeImports(await fs.readFile(file, 'utf8'))) {
        const resolved = path.resolve(path.dirname(file), stripQuery(specifier));
        const relative = toPosix(path.relative(featuresRoot, resolved));
        if (relative.startsWith('..')) continue;
        const [target, ...rest] = relative.split('/');
        if (target === feature || !featureNames.has(target)) continue;
        edges.add(`${feature} -> ${target}/${rest.join('/')}`);
      }
    }
  }
  return [...edges].toSorted();
}

async function collectProductionFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      files.push(...(await collectProductionFiles(entryPath)));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(entryPath);
    }
  }
  return files;
}

function extractRelativeImports(source: string): string[] {
  // 生产代码统一使用单引号静态 import/export；动态 import 走相同引号约定。
  return [...source.matchAll(/(?:from|import\()\s*'(\.\.?\/[^']+)'/g)].map(match => match[1]);
}

function stripQuery(specifier: string): string {
  return specifier.replace(/\?[^?]*$/, '');
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function isInside(candidate: string, rootDir: string): boolean {
  const relative = path.relative(rootDir, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
