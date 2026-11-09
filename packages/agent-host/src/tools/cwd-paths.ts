import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** 原生 read、ls、find、grep 的目标路径参数；ls、find、grep 省略时为工作目录。 */
const pathTools = new Set(['read', 'ls', 'find', 'grep']);

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/** 目标尚不存在时取最近存在的祖先的真实路径再拼回剩余段，经链接指向目录外的路径按目录外判定。 */
async function realTarget(target: string): Promise<string> {
  const missing: string[] = [];
  let probe = target;
  while (true) {
    try {
      return join(await realpath(probe), ...missing.reverse());
    } catch (error) {
      const parent = dirname(probe);
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === probe) throw error;
      missing.push(basename(probe));
      probe = parent;
    }
  }
}

/**
 * 原生文件工具的目标是否落在工作目录内，落在目录内的调用不逐次询问。
 * pi 会展开 `~`、去掉 `@` 前缀、转换 `file://` 与 Git Bash 盘符写法（Windows 上以斜杠开头），
 * 这些写法以及无法解析真实路径的目标都交给逐次授权。
 */
export async function targetsCwd(toolName: string, input: unknown, cwd: string): Promise<boolean> {
  if (!pathTools.has(toolName)) return false;
  const path = (input as { path?: unknown }).path ?? '';
  if (typeof path !== 'string' || /^[~@]|^file:|[\u00A0\u2000-\u200A\u202F\u205F\u3000]/.test(path)) return false;
  if (process.platform === 'win32' && /^[\\/]/.test(path)) return false;
  try {
    return inside(await realpath(cwd), await realTarget(resolve(cwd, path)));
  } catch {
    return false;
  }
}
