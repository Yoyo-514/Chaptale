import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { packWorkspace } from './archive';
import { timestamp } from './remote-layout';

/** 还原前快照最多留几份。 */
const KEEP_GUARDS = 3;

/**
 * 还原前快照。
 *
 * 原地覆盖与合并是仅有的两种会动**现有文件**的操作，快照是它们唯一的兜底——
 * 所以它不是可选项：快照失败就不执行（调用侧据此拒绝恢复）。
 *
 * 落在 `~/.chaptale/cache/<作品>/restore-guard/`，**不进作品目录**：快照本身既不该被
 * 下一次备份收进去，也不该出现在作者的目录树里。
 */
export type RestoreGuard = { id: string };

export async function createRestoreGuard(input: {
  workspaceRoot: string;
  guardRoot: string;
  at: Date;
  signal?: AbortSignal;
}): Promise<RestoreGuard> {
  const id = timestamp(input.at);
  const target = path.join(input.guardRoot, `${id}.zip`);
  const partial = `${target}.partial`;

  await mkdir(input.guardRoot, { recursive: true });

  try {
    // 快照的落脚点就是它最终的位置，所以这里自己补一次 temp → rename：中断留下的半成品
    // 会被清掉，而不是混进“最近三份”里、被当成一份可以回滚的快照。
    await packWorkspace({ rootPath: input.workspaceRoot, targetPath: partial, signal: input.signal });
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);

    throw error;
  }

  await pruneGuards(input.guardRoot);

  return { id };
}

/**
 * 只留最近 3 份。
 *
 * 排序靠**文件名里的时间戳**，不靠文件系统给的修改时间——后者会被同步客户端改掉，
 * 于是"留最近三份"会随机删掉作者最想要的那一份。
 *
 * 清理失败不回滚快照：快照还在，恢复可以继续；留给下一次再清。
 */
async function pruneGuards(guardRoot: string): Promise<void> {
  const names = (await readdir(guardRoot)).filter(name => name.endsWith('.zip')).toSorted();

  for (const name of names.slice(0, Math.max(0, names.length - KEEP_GUARDS))) {
    await rm(path.join(guardRoot, name), { force: true }).catch(() => undefined);
  }

  // 中断留下的半成品不算快照，也不占位置。
  for (const name of (await readdir(guardRoot)).filter(item => item.endsWith('.partial'))) {
    await rm(path.join(guardRoot, name), { force: true }).catch(() => undefined);
  }
}
