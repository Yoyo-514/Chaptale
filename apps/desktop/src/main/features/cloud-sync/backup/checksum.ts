import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

/**
 * 比对用的内容指纹。
 *
 * 比对表问的是“这两份是不是同一份内容”，不是“谁更新”——所以比字节指纹，不比修改时间：
 * 网盘客户端会改 mtime，拿它做判断会得到错的答案（同 `archiveFileName` 的注释）。
 */
export function checksum(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** 走流：作品里的单个文件可能远大于归档，不该为了算指纹整份读进内存。 */
export async function checksumFile(absolutePath: string): Promise<string> {
  const hash = createHash('sha256');

  await pipeline(createReadStream(absolutePath), hash);

  return hash.digest('hex');
}
