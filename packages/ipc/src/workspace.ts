import type { Static } from 'typebox';

import type { ListDirectoryArgsSchema } from './schemas/workspace';

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
