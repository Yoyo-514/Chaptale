import path from 'node:path';

/**
 * 文件工具的会话边界守卫：所有工具路径必须解析进 cwd 之内。
 * 规范化后越界即拒绝，防止模型构造 ../ 序列逃出工作区。
 */

export function resolveWithinCwd(cwd: string, target: string): string {
  const resolved = path.resolve(cwd, target);
  const normalizedCwd = path.resolve(cwd);

  if (resolved !== normalizedCwd && !resolved.startsWith(`${normalizedCwd}${path.sep}`)) {
    throw new Error(`拒绝访问工作区之外的路径：${target}（会话目录：${normalizedCwd}）`);
  }

  return resolved;
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
        regex += '.*';
        index += 2;

        // `a/**/b` 同时匹配 `a/b`：吞掉 ** 后紧跟的分隔符。
        if (pattern[index] === '/') {
          index += 1;
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
