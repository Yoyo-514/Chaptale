import { promises as fs } from 'node:fs';
import path from 'node:path';

import { EXTERNAL_ACCESS_CAPABILITIES } from '@chaptale/shared';

import type { ToolExecutionContext, ToolPermissionRequest } from '../../core/tool-protocol/definition';
import {
  isWithinAnyRoot,
  isWithinDirectory,
  resolveToolPath,
  toRuleSubjectPath
} from '../../infra/filesystem/path-guard';

export type ExternalAccessOptions = {
  /** 永不开放给 AI 的目录：Chaptale 配置目录里有模型凭据、云盘 token 与全局授权规则。 */
  protectedRoots: readonly string[];
};

export type FileAccess = 'read' | 'write';

/** 作品外可写的文本类型：与草稿边界同一口径，不产出可执行或配置类文件。 */
const EXTERNAL_WRITABLE_EXTENSION = /\.(md|markdown|txt)$/i;

/**
 * 本次调用的授权请求：作品内返回 null（沿用工具的静态分级），作品外升级为 external_read / external_write。
 * 硬性护栏在此抛错——不可放行的目标不弹授权卡片。
 */
export async function describeFileAccess(
  cwd: string,
  target: string,
  access: FileAccess,
  options: ExternalAccessOptions
): Promise<ToolPermissionRequest | null> {
  const resolved = await resolveToolPath(cwd, target);

  return resolved.external ? describeExternalAccess(resolved.real, target, access, options) : null;
}

/**
 * 执行期路径：作品内返回词法路径（与既有行为一致）；作品外必须持有闸门批准的同一请求——
 * 能力与真实路径逐字一致才放行，挡住直接调用 execute 与授权之后的目标漂移。
 */
export async function resolveAuthorizedPath(
  cwd: string,
  target: string,
  access: FileAccess,
  options: ExternalAccessOptions,
  context: ToolExecutionContext | undefined
): Promise<{ path: string; external: boolean }> {
  const resolved = await resolveToolPath(cwd, target);

  if (!resolved.external) {
    return { path: resolved.absolute, external: false };
  }

  const authorized = context?.authorized;

  if (!authorized) {
    throw new Error(`访问作品之外的路径需要作者授权：${target}`);
  }

  const expected = await describeExternalAccess(resolved.real, target, access, options);

  if (authorized.capability !== expected.capability || authorized.subject !== expected.subject) {
    throw new Error(`本次访问的目标与作者批准的不一致，已拒绝：${target}`);
  }

  return { path: resolved.real, external: true };
}

/** 输出路径：作品内给相对路径（与既有输出一致），作品外给绝对路径，模型可以原样再用。 */
export function displayPath(cwd: string, filePath: string, external: boolean): string {
  return external
    ? toRuleSubjectPath(filePath, { directory: false })
    : path.relative(cwd, filePath).replace(/\\/g, '/');
}

/**
 * 作品外遍历（grep/find）的目录过滤：授权阶段只核对了起点，起点之下的受保护目录要在遍历时跳过——
 * 授权一个上层目录（如用户主目录）不能顺带把配置目录里的凭据搜出来。
 * 遍历本身不跟随链接，拼出的路径即真实路径，按真实根目录比对即可。
 */
export async function createProtectedDirectoryFilter(
  options: ExternalAccessOptions
): Promise<(directory: string) => boolean> {
  const roots = await Promise.all(
    options.protectedRoots.map(root => fs.realpath(root).catch(() => path.resolve(root)))
  );

  return directory => roots.some(root => isWithinDirectory(root, directory));
}

async function describeExternalAccess(
  real: string,
  target: string,
  access: FileAccess,
  options: ExternalAccessOptions
): Promise<ToolPermissionRequest> {
  if (await isWithinAnyRoot(options.protectedRoots, real)) {
    throw new Error(`该路径位于 Chaptale 配置目录内，不对 AI 开放：${target}`);
  }

  if (access === 'write') {
    await assertExternalWritable(real, options);
  }

  const directory = await fs.stat(real).then(
    stat => stat.isDirectory(),
    () => false
  );

  return access === 'read'
    ? {
        capability: EXTERNAL_ACCESS_CAPABILITIES.read,
        riskLevel: 'sensitive',
        subject: toRuleSubjectPath(real, { directory })
      }
    : {
        capability: EXTERNAL_ACCESS_CAPABILITIES.write,
        riskLevel: 'mutating',
        subject: toRuleSubjectPath(real, { directory })
      };
}

/**
 * 作品外写入的额外约束：只写文本、不进隐藏目录、不落进任何 Chaptale 作品。
 *
 * 最后一条守的是其他作品的候选稿与提议流程——文件工具在作品内只能写草稿，
 * 不能换一条作品外的路径就绕过去。作品根的标记是 chaptale.json 或 .chaptale/；
 * 本机配置目录（~/.chaptale）同名，按受保护根目录排除。
 */
async function assertExternalWritable(real: string, options: ExternalAccessOptions): Promise<void> {
  if (!EXTERNAL_WRITABLE_EXTENSION.test(real)) {
    throw new Error('作品外只能写入 .md / .markdown / .txt 文本文件');
  }

  if (real.split(/[\\/]/).some(segment => segment.startsWith('.'))) {
    throw new Error('作品外写入不能进入隐藏目录，也不能写隐藏文件');
  }

  for (let directory = path.dirname(real); ; directory = path.dirname(directory)) {
    if (await isWorkRoot(directory, options)) {
      throw new Error('目标位于另一部 Chaptale 作品内：请打开那部作品，按候选稿与提议流程修改');
    }

    if (path.dirname(directory) === directory) {
      return;
    }
  }
}

async function isWorkRoot(directory: string, options: ExternalAccessOptions): Promise<boolean> {
  const hasManifest = await fs.stat(path.join(directory, 'chaptale.json')).then(
    stat => stat.isFile(),
    () => false
  );

  if (hasManifest) {
    return true;
  }

  const metadata = path.join(directory, '.chaptale');
  const hasMetadata = await fs.stat(metadata).then(
    stat => stat.isDirectory(),
    () => false
  );

  return hasMetadata && !(await isWithinAnyRoot(options.protectedRoots, await fs.realpath(metadata)));
}
