import { writeFile } from 'atomically';

const ATOMIC_WRITE_TIMEOUT_MS = 2_000;

/**
 * 将 JSON 写入同目录临时文件并原子替换目标文件。
 *
 * 底层负责同路径排队、fsync、瞬时文件占用重试和失败清理；此包装层只保留
 * Chaptale 的 JSON 格式与非法值检查，避免文件基础设施依赖具体第三方 API。
 */
export async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value, null, 2);

  if (serialized === undefined) {
    throw new TypeError('无法序列化为 JSON');
  }

  await writeFile(filePath, `${serialized}\n`, {
    encoding: 'utf8',
    fsync: true,
    fsyncWait: true,
    tmpPurge: true,
    timeout: ATOMIC_WRITE_TIMEOUT_MS
  });
}
