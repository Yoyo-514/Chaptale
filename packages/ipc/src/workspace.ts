import type { Static } from 'typebox';

import type { CreateEntryArgsSchema, ListDirectoryArgsSchema } from './schemas/workspace';

export type WorkspaceState = { rootPath: string | null; displayName: string | null; hasChaptaleMetadata: boolean };
export type ListDirectoryArgs = Static<typeof ListDirectoryArgsSchema>;
export type DirectoryEntry = {
  name: string;
  kind: 'file' | 'directory';
  relativePath: string;
  size?: number;
  mtimeMs?: number;
};
export type ListDirectoryResult =
  | { ok: true; entries: DirectoryEntry[] }
  | {
      ok: false;
      code: 'not-found' | 'not-a-directory' | 'outside-workspace' | 'read-failed' | 'no-workspace';
      message: string;
    };

export type CreateEntryArgs = Static<typeof CreateEntryArgsSchema>;
/** 新建结果回传创建出的条目，Renderer 据此定位并选中，无需再猜排序位置。 */
export type CreateEntryResult =
  | { ok: true; entry: DirectoryEntry }
  | {
      ok: false;
      code: 'already-exists' | 'invalid-name' | 'outside-workspace' | 'no-workspace' | 'write-failed';
      message: string;
    };
