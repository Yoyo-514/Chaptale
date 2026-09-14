import type { CloudRestorePlanEntry } from '@chaptale/ipc-contract';

import type { FileIdentity } from '../file-identity';

/**
 * 恢复比对：本地当前 × 归档，逐文件产出四类动作。
 *
 * ```txt
 * 仅归档有          → 新增到本地
 * 仅本地有          → 保留（不进清单，只报个数）
 * 两边都有且一致     → 跳过
 * 两边都有但不同     → 冲突，逐项由作者决定
 * ```
 *
 * **不做行级三方合并**：`design-docs/03 §1.5` 早已把三方合并排除在范围外，自动合并正文是毁稿路径。
 * 这里是逐文件挑选 + 作者确认，与仓库既有的“提案 → 审阅 → 确认”形状同构。
 *
 * 判“一致”看内容指纹，不看字节数、也不看修改时间：网盘客户端会改 mtime，
 * 大小相同的一份正文完全可以是改过一个字的另一份。
 */
/** 应用数据路径：界面据它分组，**不改变**四种动作的判定（见契约里的同名字段）。 */
export function isApplicationDataPath(relativePath: string): boolean {
  return relativePath === '.chaptale' || relativePath.startsWith('.chaptale/');
}

export function compareRestore(input: { archive: FileIdentity[]; local: FileIdentity[] }): {
  entries: CloudRestorePlanEntry[];
  localOnly: number;
} {
  const local = new Map(input.local.map(file => [file.relativePath, file]));
  const archived = new Set(input.archive.map(file => file.relativePath));

  return {
    entries: input.archive
      .map(file => {
        const current = local.get(file.relativePath);

        if (!current) {
          return {
            relativePath: file.relativePath,
            verdict: 'add' as const,
            archiveBytes: file.bytes,
            localBytes: null,
            system: isApplicationDataPath(file.relativePath)
          };
        }

        return {
          relativePath: file.relativePath,
          verdict: current.digest === file.digest ? ('identical' as const) : ('conflict' as const),
          archiveBytes: file.bytes,
          localBytes: current.bytes,
          system: isApplicationDataPath(file.relativePath)
        };
      })
      // 归档侧本来就有序，但两侧来源不同（zip 条目 vs 目录遍历），这里重新定序让计划可预期。
      .toSorted((left, right) => (left.relativePath < right.relativePath ? -1 : 1)),
    localOnly: input.local.filter(file => !archived.has(file.relativePath)).length
  };
}
