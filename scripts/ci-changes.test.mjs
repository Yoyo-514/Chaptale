import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyChanges } from './ci-changes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('只改文档时不跑测试和打包', () => {
  assert.deepEqual(classifyChanges(['README.md', 'docs/guide/search.md', 'docs/.vitepress/config.ts', 'LICENCE']), {
    code: false,
    packaging: false
  });
  assert.deepEqual(classifyChanges(['packages/storage/README.md', 'apps/desktop/README.md']), {
    code: false,
    packaging: false
  });
});

test('界面代码改动跑测试，不打包', () => {
  assert.deepEqual(classifyChanges(['apps/desktop-ui/src/features/shell/TitleBar.vue', 'README.md']), {
    code: true,
    packaging: false
  });
  assert.deepEqual(classifyChanges(['e2e/electron/editor.spec.ts', 'scripts/release-targets.mjs']), {
    code: true,
    packaging: false
  });
});

test('桌面主进程、公共包、锁文件、工作流和冒烟脚本的改动要打包', () => {
  for (const file of [
    'apps/desktop/src/main/index.ts',
    'packages/storage/src/schema.ts',
    'pnpm-lock.yaml',
    '.github/workflows/package.yml',
    'scripts/smoke-packaged.mjs'
  ]) {
    assert.deepEqual(classifyChanges(['README.md', file]), { code: true, packaging: true }, file);
  }
});

test('没有可比较的基准提交时全部作业都跑', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'chaptale-ci-changes-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'output');
  for (const args of [[], ['0000000000000000000000000000000000000000']]) {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'ci-changes.mjs'), ...args], {
      cwd: root,
      env: { ...process.env, GITHUB_OUTPUT: output },
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(await readFile(output, 'utf8'), 'code=true\npackaging=true\n'.repeat(2));
});

test('与当前提交比较时没有改动', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'chaptale-ci-changes-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'output');
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'ci-changes.mjs'), 'HEAD'], {
    cwd: root,
    env: { ...process.env, GITHUB_OUTPUT: output },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(output, 'utf8'), 'code=false\npackaging=false\n');
});
