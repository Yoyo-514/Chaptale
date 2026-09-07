import { writeFile } from 'atomically';
import { randomUUID } from 'node:crypto';
import { link, open, unlink } from 'node:fs/promises';
import path from 'node:path';

export async function writeTextAtomically(target: string, content: string): Promise<void> {
  await writeFile(target, content, { encoding: 'utf8', fsync: true, fsyncWait: true, tmpPurge: true, timeout: 2_000 });
}

/** 新建使用同目录临时文件与排他 hard-link；目标已存在时绝不替换。 */
export async function createTextAtomically(target: string, content: string): Promise<void> {
  const temporary = path.join(path.dirname(target), `.chaptale-create-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporary, target);
  } finally {
    await unlink(temporary);
  }
}
