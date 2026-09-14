import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * 文件工具的会话边界守卫：所有工具路径必须解析进 cwd 之内。
 * 词法检查快速失败，realpath 复核防符号链接逃逸。
 * 目标尚不存在（新建文件）时，取最近存在祖先的真实路径再拼回剩余段。
 */
export async function resolveWithinCwd(cwd: string, target: string): Promise<string> {
  const resolved = path.resolve(cwd, target);
  const normalizedCwd = path.resolve(cwd);

  if (!isWithinDirectory(normalizedCwd, resolved)) {
    throw new Error(`拒绝访问作品之外的路径：${target}（边界目录：${normalizedCwd}）`);
  }

  const [realCwd, realTarget] = await Promise.all([fs.realpath(normalizedCwd), resolveWithRealAncestor(resolved)]);

  if (!isWithinDirectory(realCwd, realTarget)) {
    throw new Error(`拒绝访问作品之外的路径（符号链接目标越界）：${target}（边界目录：${normalizedCwd}）`);
  }

  return resolved;
}

/** relative 同时处理根目录尾斜杠与 Windows 盘符大小写，不用字符串前缀猜目录归属。 */
function isWithinDirectory(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** realpath 兜底：目标不存在时逐级向上取最近存在的祖先的真实路径，再拼回剩余段。 */
async function resolveWithRealAncestor(resolved: string): Promise<string> {
  const missing: string[] = [];
  let probe = resolved;

  // 每轮都移向父目录，根目录即终点；固定层数会让深路径绕过真实路径校验。
  while (true) {
    try {
      const realProbe = await fs.realpath(probe);
      if (missing.length && !(await fs.stat(realProbe)).isDirectory()) {
        throw Object.assign(new Error(`父路径不是目录：${probe}`), { code: 'ENOTDIR' });
      }
      return path.join(realProbe, ...missing.toReversed());
    } catch (error) {
      // 权限、链接环和非目录错误不能当作“尚未创建”放行。
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(probe);
      if (parent === probe) throw error;
      missing.push(path.basename(probe));
      probe = parent;
    }
  }
}

/** 目录递归的默认忽略清单（依赖产物与版本库内部，对创作工具是纯噪声）。 */
export const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.cache',
  '__pycache__',
  '.venv'
]);

/** 简化 glob → RegExp：** 跨目录、* 单段、? 单字符；其余字符按字面量。 */
export function globToRegExp(pattern: string): RegExp {
  let regex = '';
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index] as string;

    if (char === '*') {
      if (pattern[index + 1] === '*') {
        index += 2;

        // 目录可以省略，但存在时必须以 / 结束，不能吞掉 b 的文件名前缀。
        if (pattern[index] === '/') {
          regex += '(?:[^/]+/)*';
          index += 1;
        } else {
          regex += '.*';
        }
      } else {
        regex += '[^/]*';
        index += 1;
      }
    } else if (char === '?') {
      regex += '[^/]';
      index += 1;
    } else if ('\\^$.|+()[]{}'.includes(char)) {
      regex += `\\${char}`;
      index += 1;
    } else {
      regex += char;
      index += 1;
    }
  }

  return new RegExp(`^${regex}$`);
}

/** 二进制探测：前 8KB 出现 NUL 字节即判二进制。 */
export function isBinaryContent(buffer: Buffer): boolean {
  return buffer.subarray(0, 8192).includes(0);
}
