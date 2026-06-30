import { config } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 加载仓库根目录的 .env 文件。
 *
 * Electron 主进程不再通过 NestJS/tsx 的 --env-file 启动，因此这里显式使用 dotenv。
 */
export function loadRootEnv() {
  const envPath = findEnvPath();

  if (!envPath) {
    return;
  }

  config({ path: envPath });
}

function findEnvPath() {
  let current = process.cwd();

  for (let depth = 0; depth < 4; depth += 1) {
    const candidate = path.join(current, '.env');

    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  return undefined;
}
