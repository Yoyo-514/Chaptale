import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

const forbiddenPackages = ['@earendil-works/pi-ai', '@earendil-works/pi-coding-agent', 'pi-web-access'] as const;

type ForbiddenPackage = (typeof forbiddenPackages)[number];

type DependencyViolation = {
  file: string;
  dependency: ForbiddenPackage;
  specifier: string;
};

/**
 * 任务 6-8 每迁移一批 Pi 实现与测试，就删除对应的精确条目，最终必须清空。
 * 这里只按“相对文件路径 + 完整 import specifier”临时放行，禁止目录通配符或包级忽略。
 */
const legacyAllowlist: string[] = [];

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe('Pi 依赖边界扫描器', () => {
  it('识别三项禁用包的根导入和子路径导入', async () => {
    const rootDir = await createTemporarySourceTree({
      'sample.ts': [
        "import '@earendil-works/pi-ai';",
        "import type { ImageContent } from '@earendil-works/pi-ai/compat';",
        "import '@earendil-works/pi-coding-agent';",
        "export type { AgentSession } from '@earendil-works/pi-coding-agent/core';",
        "import 'pi-web-access';",
        "const extension = import('pi-web-access/extensions');"
      ].join('\n')
    });

    const violations = await findDependencyViolations(rootDir);

    expect(violations.map(({ dependency, specifier }) => ({ dependency, specifier }))).toEqual([
      { dependency: '@earendil-works/pi-ai', specifier: '@earendil-works/pi-ai' },
      { dependency: '@earendil-works/pi-ai', specifier: '@earendil-works/pi-ai/compat' },
      { dependency: '@earendil-works/pi-coding-agent', specifier: '@earendil-works/pi-coding-agent' },
      { dependency: '@earendil-works/pi-coding-agent', specifier: '@earendil-works/pi-coding-agent/core' },
      { dependency: 'pi-web-access', specifier: 'pi-web-access' },
      { dependency: 'pi-web-access', specifier: 'pi-web-access/extensions' }
    ]);
  });

  it('识别双参数动态 import 的根导入和子路径导入', async () => {
    const rootDir = await createTemporarySourceTree({
      'dynamic-import.ts': [
        "const root = import('pi-web-access', {});",
        "const extension = import('pi-web-access/extensions', {});"
      ].join('\n')
    });

    const violations = await findDependencyViolations(rootDir);

    expect(violations.map(({ dependency, specifier }) => ({ dependency, specifier }))).toEqual([
      { dependency: 'pi-web-access', specifier: 'pi-web-access' },
      { dependency: 'pi-web-access', specifier: 'pi-web-access/extensions' }
    ]);
  });

  it('识别普通 require 的禁包字面量且忽略安全与动态 specifier', async () => {
    const rootDir = await createTemporarySourceTree({
      'commonjs.ts': [
        "require('@earendil-works/pi-ai');",
        "require('@earendil-works/pi-coding-agent/core');",
        "require('pi-web-access/extensions');",
        "require('node:path');",
        "const packageName = 'pi-web-access';",
        'require(packageName);',
        "const extension = 'extensions';",
        'require(`pi-web-access/${extension}`);'
      ].join('\n')
    });

    const violations = await findDependencyViolations(rootDir);

    expect(violations.map(({ dependency, specifier }) => ({ dependency, specifier }))).toEqual([
      { dependency: '@earendil-works/pi-ai', specifier: '@earendil-works/pi-ai' },
      {
        dependency: '@earendil-works/pi-coding-agent',
        specifier: '@earendil-works/pi-coding-agent/core'
      },
      { dependency: 'pi-web-access', specifier: 'pi-web-access/extensions' }
    ]);
  });

  it('识别 ImportTypeNode 的根导入和子路径导入', async () => {
    const rootDir = await createTemporarySourceTree({
      'import-type.ts': [
        "type RootSession = import('@earendil-works/pi-coding-agent').AgentSession;",
        "type CoreSession = import('@earendil-works/pi-coding-agent/core').AgentSession;"
      ].join('\n')
    });

    const violations = await findDependencyViolations(rootDir);

    expect(violations.map(({ dependency, specifier }) => ({ dependency, specifier }))).toEqual([
      {
        dependency: '@earendil-works/pi-coding-agent',
        specifier: '@earendil-works/pi-coding-agent'
      },
      {
        dependency: '@earendil-works/pi-coding-agent',
        specifier: '@earendil-works/pi-coding-agent/core'
      }
    ]);
  });

  it('忽略注释、普通字符串、integrations/pi 目录与测试文件', async () => {
    const rootDir = await createTemporarySourceTree({
      'safe.ts': ["// import 'pi-web-access';", "const packageName = '@earendil-works/pi-ai';"].join('\n'),
      'integrations/pi/adapter.ts': "import '@earendil-works/pi-coding-agent';",
      'modules/sample/__tests__/sample.test.ts': "import { parseFrontmatter } from '@earendil-works/pi-coding-agent';",
      'modules/sample/inline.test.ts': "import '@earendil-works/pi-ai';"
    });

    await expect(findDependencyViolations(rootDir)).resolves.toEqual([]);
  });

  it('精确 allowlist 不会放过同文件同 specifier 的新增重复导入', () => {
    const violation: DependencyViolation = {
      file: 'legacy.ts',
      dependency: 'pi-web-access',
      specifier: 'pi-web-access'
    };

    expect(findBoundaryIssues([violation, violation], ['legacy.ts::pi-web-access'])).toEqual({
      unexpectedViolations: [violation],
      staleAllowlistEntries: []
    });
  });
});

describe('Pi 依赖边界', () => {
  it('integrations/pi 外没有新增或未登记的 Pi 上游包导入', async () => {
    const mainRoot = path.resolve(import.meta.dirname, '../../..');
    const violations = await findDependencyViolations(mainRoot);
    const { unexpectedViolations, staleAllowlistEntries } = findBoundaryIssues(violations, legacyAllowlist);

    expect(formatBoundaryIssues(unexpectedViolations, staleAllowlistEntries)).toBe('');
  });
});

describe('模块依赖边界', () => {
  it('attachments 不依赖 context', async () => {
    const mainRoot = path.resolve(import.meta.dirname, '../../..');
    const attachmentsRoot = path.join(mainRoot, 'modules/attachments');
    const contextRoot = path.join(mainRoot, 'modules/context');
    const imports = await findRelativeImportsInto(attachmentsRoot, contextRoot);

    expect(imports).toEqual([]);
  });

  it('modules 生产代码不导入 integrations 实现', async () => {
    const mainRoot = path.resolve(import.meta.dirname, '../../..');
    const modulesRoot = path.join(mainRoot, 'modules');
    const integrationsRoot = path.join(mainRoot, 'integrations');
    const imports = await findRelativeImportsInto(modulesRoot, integrationsRoot);

    expect(imports).toEqual([]);
  });
});

async function createTemporarySourceTree(files: Record<string, string>): Promise<string> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-pi-boundary-'));
  temporaryDirectories.push(rootDir);

  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const filePath = path.join(rootDir, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf8');
    })
  );

  return rootDir;
}

async function findDependencyViolations(rootDir: string): Promise<DependencyViolation[]> {
  const sourceFiles = await collectTypeScriptFiles(rootDir);
  const violations = await Promise.all(
    sourceFiles.map(async filePath => {
      const source = await fs.readFile(filePath, 'utf8');
      const relativePath = toPosixPath(path.relative(rootDir, filePath));
      return collectFileViolations(relativePath, source);
    })
  );

  return violations.flat().toSorted(compareViolations);
}

async function findRelativeImportsInto(sourceRoot: string, targetRoot: string): Promise<string[]> {
  const sourceFiles = await collectTypeScriptFiles(sourceRoot);
  const imports = await Promise.all(
    sourceFiles.map(async filePath => {
      const source = await fs.readFile(filePath, 'utf8');
      const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      return sourceFile.statements.flatMap(statement => {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
          return [];
        }

        const specifier = statement.moduleSpecifier.text;
        const resolvedPath = path.resolve(path.dirname(filePath), specifier);
        return resolvedPath === targetRoot || resolvedPath.startsWith(`${targetRoot}${path.sep}`)
          ? [`${toPosixPath(path.relative(sourceRoot, filePath))}::${specifier}`]
          : [];
      });
    })
  );

  return imports.flat().toSorted();
}

async function collectTypeScriptFiles(directory: string, rootDir = directory): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async entry => {
      const entryPath = path.join(directory, entry.name);
      const relativePath = toPosixPath(path.relative(rootDir, entryPath));

      if (entry.isDirectory()) {
        return isPiIntegrationPath(relativePath) || entry.name === '__tests__'
          ? []
          : collectTypeScriptFiles(entryPath, rootDir);
      }

      // 边界红线只约束源码；测试文件允许直接使用 pi 上游包（mock 与纯函数复用）。
      return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [entryPath] : [];
    })
  );

  return files.flat();
}

function collectFileViolations(file: string, source: string): DependencyViolation[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: DependencyViolation[] = [];

  const addViolation = (specifier: string) => {
    const dependency = forbiddenPackages.find(
      candidate => specifier === candidate || specifier.startsWith(`${candidate}/`)
    );

    if (dependency) {
      violations.push({ file, dependency, specifier });
    }
  };

  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      addViolation(readStringLiteral(node.moduleSpecifier));
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      addViolation(readStringLiteral(node.arguments[0]!));
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      addViolation(readStringLiteral(node.arguments[0]!));
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      addViolation(readStringLiteral(node.argument.literal));
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    ) {
      addViolation(readStringLiteral(node.moduleReference.expression));
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

function readStringLiteral(node: ts.Node): string {
  return ts.isStringLiteralLike(node) ? node.text : '';
}

function isPiIntegrationPath(relativePath: string): boolean {
  return relativePath === 'integrations/pi' || relativePath.startsWith('integrations/pi/');
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function compareViolations(left: DependencyViolation, right: DependencyViolation): number {
  return left.file.localeCompare(right.file) || left.specifier.localeCompare(right.specifier);
}

function toViolationKey({ file, specifier }: DependencyViolation): string {
  return `${file}::${specifier}`;
}

function findBoundaryIssues(violations: DependencyViolation[], allowedEntries: string[]) {
  const unmatchedAllowlistEntries = [...allowedEntries];
  const unexpectedViolations: DependencyViolation[] = [];

  for (const violation of violations) {
    const allowlistIndex = unmatchedAllowlistEntries.indexOf(toViolationKey(violation));

    if (allowlistIndex === -1) {
      unexpectedViolations.push(violation);
    } else {
      unmatchedAllowlistEntries.splice(allowlistIndex, 1);
    }
  }

  return {
    unexpectedViolations,
    staleAllowlistEntries: unmatchedAllowlistEntries
  };
}

function formatBoundaryIssues(violations: DependencyViolation[], staleAllowlistEntries: string[]): string {
  const unexpected = violations.map(
    ({ file, dependency, specifier }) => `新增越界 import: ${file}: ${dependency} (${specifier})`
  );
  const stale = staleAllowlistEntries.map(entry => `失效 allowlist 条目（迁移后应删除）: ${entry}`);
  return [...unexpected, ...stale].join('\n');
}
