import { writeFile } from 'atomically';

/**
 * 字节级原子写：临时文件写完、sync 过再改名。
 *
 * 恢复要把归档里的文件写回作品目录，中途失败不能留下被截断的正文——
 * 与 `writeTextAtomically` 是同一个依赖（`atomically`），区别只在载荷是字节而不是文本。
 * `tmpPurge` 让上一次中断留下的临时文件在下次写入时被清掉。
 */
export async function writeBytesAtomically(target: string, data: Uint8Array): Promise<void> {
  await writeFile(target, data, { fsync: true, fsyncWait: true, tmpPurge: true, timeout: 2_000 });
}
