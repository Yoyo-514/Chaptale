import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const directory = process.argv[2];
assert.ok(directory, '请提供安装包目录');
const files = (await readdir(directory)).filter(file => /\.(exe|dmg|zip|AppImage|deb)$/.test(file)).toSorted();
const { version } = JSON.parse(await readFile(new URL('../apps/desktop/package.json', import.meta.url), 'utf8'));
for (const target of [
  'win-x64.exe',
  'linux-x64.AppImage',
  'linux-x64.deb',
  'mac-x64.dmg',
  'mac-x64.zip',
  'mac-arm64.dmg',
  'mac-arm64.zip'
]) {
  assert.ok(files.includes(`Chaptale-${version}-${target}`), `缺少安装包：${target}`);
}
const lines = [];
for (const file of files) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(directory, file))) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${file}`);
}
await writeFile(path.join(directory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
console.log(`Checksums written for ${files.length} installers`);
