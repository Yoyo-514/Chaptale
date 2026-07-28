import { promises as fs } from 'node:fs';
import path from 'node:path';

import { writeJsonAtomically } from './atomic-json';

export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');

    // 容忍空文件 / 损坏文件：设置文件可从默认值再生，不应让单次读取失败拖死所有 IPC handler。
    if (!raw.trim()) {
      return undefined;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

export async function writeJsonFile(filePath: string, value: unknown) {
  await writeJsonAtomically(filePath, value);
}

/** 读取可能不存在的文本文件；ENOENT 返回 undefined，其余错误照抛。 */
export async function readOptionalTextFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

export async function writeTextFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}
