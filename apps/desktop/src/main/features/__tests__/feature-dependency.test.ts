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
 * - 所有边必须保持无运行时环。反向运行时边现已归零：memory 目录布局（纯 path.join、
 *   零 feature 依赖、被 memory 与 search 共用）已上提到 core/memory-layout，
 *   原先唯一的 search -> memory/paths 因此消失；memory -> personas 与
 *   personas -> search 均为 type-only。
 */
const crossFeatureAllowlist = [
  // agent 运行时装配（chat-bundle / tool-assembly / service）按职责引用各 feature 的端口与工具。
  'agent -> file-tools/tools',
  'agent -> memory/compaction/pressure',
  'agent -> memory/pending/store',
  'agent -> memory/protocol',
  'agent -> memory/tools',
  'agent -> permissions/broker',
  // 闸门在 chat-bundle 内做「三层规则求值 → broker 兜底」，因此同时依赖规则库与求值器。
  'agent -> permissions/engine',
  'agent -> permissions/rule-store',
  'agent -> personas/builtin',
  'agent -> personas/memory-access',
  'agent -> personas/registry',
  'agent -> personas/task-spec',
  'agent -> prompts/compose-system-prompt',
  'agent -> prompts/product-duty',
  'agent -> search/memory/service',
  'agent -> search/memory/tool',
  'agent -> skills/provider-port',
  'agent -> subagent/delegate-tool',
  'agent -> subagent/pool',
  'agent -> tasks/runner-port',
  'agent -> todo/protocol',
  'agent -> todo/store',
  'agent -> todo/tool',
  'agent -> web-tools/content-store',
  'agent -> web-tools/settings',
  'agent -> web-tools/tools',
  'commands -> skills/provider-port',
  'memory -> personas/registry',
  'personas -> search/types',
  'prompts -> personas/builtin',
  'subagent -> personas/registry',
  'subagent -> tasks/runner-port',
  'tasks -> personas/registry',
  'tasks -> personas/task-spec',
  'tasks -> prompts/compose-system-prompt',
  'tasks -> runs/record',
  'tasks -> runs/store',
  // task 侧与 chat 共用同一个 SkillsProvider，自拼两层会漏 builtin；type-only。
  'tasks -> skills/provider-port'
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

  /**
   * core = 领域实现，零传输层；每个对 renderer 的 IPC 面都在 features/<域>/ipc.ts。
   * 留任何例外都会让「ipc.ts 归哪层」这件事每次重新判断一遍。
   */
  it('core 层不注册任何 IPC 频道', async () => {
    const files = await collectProductionFiles(path.join(mainRoot, 'core'));
    const violations: string[] = [];
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8');
      if (/\bipcMain\b|\bhandleTrustedIpc\b|\bhandleValidatedIpc\b/.test(source)) {
        violations.push(toPosix(path.relative(mainRoot, file)));
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
