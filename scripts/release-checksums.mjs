import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { releaseArtifactNames } from './release-targets.mjs';

const directory = process.argv[2];
assert.ok(directory, '请提供安装包目录');
const files = (await readdir(directory)).filter(file => /\.(exe|dmg|zip|AppImage|deb)$/.test(file)).toSorted();
const { version } = JSON.parse(await readFile(new URL('../apps/desktop/package.json', import.meta.url), 'utf8'));
for (const name of releaseArtifactNames(version)) {
  assert.ok(files.includes(name), `缺少安装包：${name}`);
}
const lines = [];
for (const file of files) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(directory, file))) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${file}`);
}
await writeFile(path.join(directory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
console.log(`Checksums written for ${files.length} installers`);
