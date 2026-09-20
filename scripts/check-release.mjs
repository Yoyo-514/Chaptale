import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const desktop = JSON.parse(await readFile(new URL('../apps/desktop/package.json', import.meta.url), 'utf8'));
assert.match(root.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, '应用版本必须符合语义化版本格式');
assert.equal(desktop.version, root.version, '根目录与桌面包的版本必须一致');
assert.equal(process.env.RELEASE_TAG, `v${root.version}`, '发布标签必须与应用版本一致');
assert.equal(root.license, 'Apache-2.0');
assert.equal(desktop.license, 'Apache-2.0');
console.log(`Release metadata verified: ${process.env.RELEASE_TAG}`);
