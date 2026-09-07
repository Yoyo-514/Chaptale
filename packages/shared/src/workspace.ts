import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';

export const WORKSPACE_ROLES = [
  'manuscript',
  'outline',
  'world',
  'characters',
  'threads',
  'drafts',
  'inspiration',
  'templates'
] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export const WorkspaceRoleSchema = Type.Union(WORKSPACE_ROLES.map(role => Type.Literal(role)));
export const WorkspaceRelativePathSchema = Type.String({
  minLength: 1,
  pattern: '^(?!.*(?:^|/)\\.{1,2}(?:/|$))[^/\\\\:\\x00]+(?:/[^/\\\\:\\x00]+)*$'
});
export const ChaptaleManifestSchema = Type.Object(
  {
    version: Type.Literal(1),
    id: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    kind: Type.Union([Type.Literal('novel'), Type.Literal('script')]),
    dirs: Type.Optional(
      Type.Partial(
        Type.Object({
          manuscript: WorkspaceRelativePathSchema,
          outline: WorkspaceRelativePathSchema,
          world: WorkspaceRelativePathSchema,
          characters: WorkspaceRelativePathSchema,
          threads: WorkspaceRelativePathSchema,
          drafts: WorkspaceRelativePathSchema,
          inspiration: WorkspaceRelativePathSchema,
          templates: WorkspaceRelativePathSchema
        })
      )
    )
  },
  { additionalProperties: true }
);
export type ChaptaleManifest = Static<typeof ChaptaleManifestSchema>;
export const ChaptaleManifestValidator = Compile(ChaptaleManifestSchema);
export const WorkspaceRelativePathValidator = Compile(WorkspaceRelativePathSchema);

export type WorkspaceLayout = {
  rootPath: string;
  manifest: ChaptaleManifest | null;
  roles: Record<WorkspaceRole, { relativePath: string; exists: boolean }>;
  diagnostics: string[];
};
