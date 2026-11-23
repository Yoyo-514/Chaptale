// 判断一次 CI 要跑哪些作业：只改文档时跳过测试，改到桌面打包相关的内容时才打四个平台的包。
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const documentation = /^(?:docs\/|LICENCE$)|\.md$/;
const packaging = /^(?:apps\/desktop\/|packages\/|\.github\/|pnpm-lock\.yaml$|scripts\/smoke-packaged\.mjs$)/;

/** 文档改动由 format:check 与 docs:build 覆盖；其余文件都算代码改动。 */
export function classifyChanges(files) {
  const code = files.filter(file => !documentation.test(file));
  return { code: code.length > 0, packaging: code.some(file => packaging.test(file)) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2];
  // 手动触发和发版没有比较基准；强制推送后旧提交也可能不在仓库里。这些情况全部作业都跑。
  const comparable = Boolean(base) && spawnSync('git', ['cat-file', '-e', `${base}^{commit}`]).status === 0;
  const result = comparable
    ? classifyChanges(
        execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean)
      )
    : { code: true, packaging: true };
  appendFileSync(process.env.GITHUB_OUTPUT, `code=${result.code}\npackaging=${result.packaging}\n`);
  console.log(comparable ? `Compared with ${base}:` : 'No comparable base, running everything:', result);
}
