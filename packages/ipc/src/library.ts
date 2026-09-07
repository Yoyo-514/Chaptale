import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';

import {
  ReferenceSelectionSchema,
  WorkspaceRelativePathSchema,
  type AssetSnapshot,
  type AssetLink,
  type ReferencePack
} from '@chaptale/shared';

import { WorkspaceRootArgsSchema } from './schemas/workspace';

export const LibraryLinkArgsSchema = Type.Object(
  {
    ...WorkspaceRootArgsSchema.properties,
    link: Type.String({ minLength: 1, maxLength: 1000 })
  },
  { additionalProperties: false }
);
export const LibraryLinkArgsValidator = Compile(Type.Tuple([LibraryLinkArgsSchema]));
export const ComposePackArgsSchema = Type.Object(
  {
    ...WorkspaceRootArgsSchema.properties,
    goal: Type.String({ maxLength: 20000 }),
    selections: Type.Array(ReferenceSelectionSchema, { maxItems: 200 }),
    budgetChars: Type.Integer({ minimum: 100, maximum: 1000000 }),
    scenePath: Type.Optional(WorkspaceRelativePathSchema)
  },
  { additionalProperties: false }
);
export type ComposePackArgs = Static<typeof ComposePackArgsSchema>;
export const ComposePackArgsValidator = Compile(Type.Tuple([ComposePackArgsSchema]));
export const PackIdArgsSchema = Type.Object(
  {
    ...WorkspaceRootArgsSchema.properties,
    packId: Type.String({ pattern: '^[a-zA-Z0-9-]{1,80}$' })
  },
  { additionalProperties: false }
);
export const PackIdArgsValidator = Compile(Type.Tuple([PackIdArgsSchema]));
export type PackFreshness = {
  stale: boolean;
  sources: Array<{ sourcePath: string; state: 'current' | 'changed' | 'missing' }>;
};
export type LibraryApi = {
  listAssets: (args: { rootPath: string }) => Promise<AssetSnapshot>;
  resolveLink: (args: Static<typeof LibraryLinkArgsSchema>) => Promise<AssetLink>;
  composePack: (args: ComposePackArgs) => Promise<ReferencePack>;
  freezePack: (args: ComposePackArgs) => Promise<ReferencePack>;
  readPack: (args: Static<typeof PackIdArgsSchema>) => Promise<ReferencePack>;
  checkPack: (args: Static<typeof PackIdArgsSchema>) => Promise<PackFreshness>;
};
