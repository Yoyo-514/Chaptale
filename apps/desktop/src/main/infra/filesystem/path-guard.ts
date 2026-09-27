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
export function isWithinDirectory(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * 文件工具的路径解析结果。
 *
 * absolute 是词法绝对路径（作品内沿用既有执行方式）；real 是真实路径（内外判定、授权比对与作品外执行都用它）。
 */
export type ResolvedToolPath = {
  absolute: string;
  real: string;
  external: boolean;
};

/**
 * 作品内外判定：与 resolveWithinCwd 同一套词法 + realpath 规则，但越界不抛错而是标记 external，
 * 交给授权层决定。作品内 ≡ 词法与真实路径都在作品内（resolveWithinCwd 放行的范围）。
 *
 * 作品外的网络/设备路径在任何 fs 调用之前拒绝：Windows 上解析 `\\host\share` 本身就会发起
 * SMB 认证，凭据等不到授权卡片就已经外发。词法在作品外、真实路径却指回作品内的链接同样拒绝，
 * 否则换个作品外的写法就能绕过作品内的草稿边界。
 */
export async function resolveToolPath(cwd: string, target: string): Promise<ResolvedToolPath> {
  const normalizedCwd = path.resolve(cwd);
  const absolute = path.resolve(normalizedCwd, target);
  const lexicallyInside = isWithinDirectory(normalizedCwd, absolute);

  if (!lexicallyInside) {
    assertLocalPath(absolute, target);
  }

  const [realCwd, real] = await Promise.all([fs.realpath(normalizedCwd), resolveWithRealAncestor(absolute)]);
  const reallyInside = isWithinDirectory(realCwd, real);

  if (reallyInside && !lexicallyInside) {
    throw new Error(`该路径经链接指回作品内，请改用作品内的相对路径：${target}`);
  }

  if (!reallyInside) {
    assertLocalPath(real, target);
  }

  return { absolute, real, external: !reallyInside };
}

/** UNC 与设备路径（`\\host\share`、`\\?\`、`\\.\`、`//host`）一律不支持。 */
export function assertLocalPath(candidate: string, target = candidate): void {
  if (/^[\\/]{2}/.test(candidate)) {
    throw new Error(`不支持访问网络或设备路径：${target}`);
  }
}

/**
 * 真实路径 → 授权规则比对用的摘要：Windows 上统一正斜杠与大写盘符；目录补尾斜杠，
 * 让 `能力(目录/*)` 规则也覆盖目录本身（ls/grep/find 的起点）。
 */
export function toRuleSubjectPath(realPath: string, options: { directory: boolean }): string {
  const normalized =
    path.sep === '\\' ? realPath.replaceAll('\\', '/').replace(/^[a-z]:/, drive => drive.toUpperCase()) : realPath;

  return options.directory && !normalized.endsWith('/') ? `${normalized}/` : normalized;
}

/** 真实路径是否落在任一根目录内；根目录尚不存在时按词法路径比对。 */
export async function isWithinAnyRoot(roots: readonly string[], realTarget: string): Promise<boolean> {
  for (const root of roots) {
    const realRoot = await fs.realpath(root).catch(() => path.resolve(root));

    if (isWithinDirectory(realRoot, realTarget)) {
      return true;
    }
  }

  return false;
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
