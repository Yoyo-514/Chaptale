import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { releaseArtifactNames } from './release-targets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const run = (script, args = [], env = {}) =>
  spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });

test('仅接受与应用版本一致的发布标签', () => {
  assert.equal(run('check-release.mjs', [], { RELEASE_TAG: `v${version}` }).status, 0);
  for (const tag of ['', version, `v${version}-wrong`]) {
    assert.notEqual(run('check-release.mjs', [], { RELEASE_TAG: tag }).status, 0);
  }
});

test('拒绝缺失平台的安装包，齐全时生成可复算的校验和', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'chaptale-release-'));
  try {
    assert.notEqual(run('release-checksums.mjs', [directory]).status, 0);
    const files = releaseArtifactNames(version);
    for (const [index, file] of files.entries()) {
      await writeFile(path.join(directory, file), `installer fixture ${index}\n`);
      if (index < files.length - 1) assert.notEqual(run('release-checksums.mjs', [directory]).status, 0);
    }
    const result = run('release-checksums.mjs', [directory]);
    assert.equal(result.status, 0, result.stderr);
    const checksums = await readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8');
    assert.equal(checksums.trim().split('\n').length, files.length);
    for (const file of files) {
      const expected = createHash('sha256')
        .update(await readFile(path.join(directory, file)))
        .digest('hex');
      assert.ok(checksums.includes(`${expected}  ${file}\n`));
    }
    assert.equal(run('release-checksums.mjs', [directory]).status, 0);
    assert.equal(await readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8'), checksums);
  } finally {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('chaptale-release-'));
    await rm(directory, { recursive: true, force: true });
  }
});
