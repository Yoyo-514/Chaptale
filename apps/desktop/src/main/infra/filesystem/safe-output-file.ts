import { promises as fs } from 'node:fs';
import path from 'node:path';

const SAFE_RUN_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export type SafeOutputFile = {
  filePath: string;
  outputRef: string;
  runId: string;
};

export function isSafeRunId(runId: string): boolean {
  return SAFE_RUN_ID_PATTERN.test(runId);
}

export function assertSafeRunId(runId: string): void {
  if (!isSafeRunId(runId)) {
    throw new Error('非法 runId：只能包含英文字母、数字、下划线和连字符');
  }
}

/** 为 save 准备安全的直接 JSON 文件路径；workspace 根本身允许是 symlink。 */
export async function prepareSafeOutputFile(
  cwd: string,
  directorySegments: string[],
  runId: string
): Promise<SafeOutputFile> {
  assertSafeRunId(runId);
  const directory = await prepareSafeDirectory(cwd, directorySegments);
  const filePath = path.join(directory, `${runId}.json`);
  const existing = await lstatOptional(filePath);

  if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
    throw new Error('输出目标必须是普通 JSON 文件，不能是符号链接或目录');
  }

  return {
    filePath,
    outputRef: `${directorySegments.join('/')}/${runId}.json`,
    runId
  };
}

/** 解析已存在的直接 JSON outputRef；非法、缺失、symlink 与非普通文件均返回 null。 */
export async function resolveExistingDirectJsonFile(
  cwd: string,
  outputRef: string,
  directorySegments: string[]
): Promise<SafeOutputFile | null> {
  const prefix = `${directorySegments.join('/')}/`;

  if (!outputRef.startsWith(prefix)) {
    return null;
  }

  const fileName = outputRef.slice(prefix.length);

  if (fileName.includes('/') || fileName.includes('\\') || !fileName.endsWith('.json')) {
    return null;
  }

  const runId = fileName.slice(0, -'.json'.length);

  if (!isSafeRunId(runId)) {
    return null;
  }

  const directory = await resolveSafeDirectoryIfExists(cwd, directorySegments);

  if (!directory) {
    return null;
  }

  const filePath = path.join(directory, `${runId}.json`);
  const existing = await lstatOptional(filePath);

  if (!existing || existing.isSymbolicLink() || !existing.isFile()) {
    return null;
  }

  return { filePath, outputRef, runId };
}

async function prepareSafeDirectory(cwd: string, directorySegments: string[]): Promise<string> {
  await assertExistingPathSegmentsAreDirectories(cwd, directorySegments);
  const directory = path.join(cwd, ...directorySegments);
  await fs.mkdir(directory, { recursive: true });
  await assertDirectoryRealpath(cwd, directorySegments, directory);
  return directory;
}

async function resolveSafeDirectoryIfExists(cwd: string, directorySegments: string[]): Promise<string | null> {
  const directory = path.join(cwd, ...directorySegments);

  try {
    await assertExistingPathSegmentsAreDirectories(cwd, directorySegments);
    await assertDirectoryRealpath(cwd, directorySegments, directory);
    return directory;
  } catch {
    return null;
  }
}

async function assertExistingPathSegmentsAreDirectories(cwd: string, directorySegments: string[]): Promise<void> {
  let current = cwd;

  for (const segment of directorySegments) {
    current = path.join(current, segment);
    const stat = await lstatOptional(current);

    if (!stat) {
      return;
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('输出目录必须位于 workspace 内部，不能是符号链接或文件');
    }
  }
}

async function assertDirectoryRealpath(cwd: string, directorySegments: string[], directory: string): Promise<void> {
  const [realCwd, realDirectory] = await Promise.all([fs.realpath(cwd), fs.realpath(directory)]);
  const expectedDirectory = path.join(realCwd, ...directorySegments);

  if (path.normalize(realDirectory) !== path.normalize(expectedDirectory)) {
    throw new Error('输出目录 realpath 超出 workspace 安全边界');
  }
}

async function lstatOptional(filePath: string): Promise<import('node:fs').Stats | null> {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: unknown }).code === 'ENOENT'
    ) {
      return null;
    }

    throw error;
  }
}
