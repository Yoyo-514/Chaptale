import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';

import {
  AssetFieldsSchema,
  ArtifactIdSchema,
  ContentHashSchema,
  WorkspaceRelativePathSchema,
  type TemplateList
} from '@chaptale/shared';

import { WorkspaceRootArgsSchema } from './schemas/workspace';
import type { WorkspaceDocument } from './workspace';

export const CreateAssetSchema = Type.Object(
  {
    ...WorkspaceRootArgsSchema.properties,
    templateId: ArtifactIdSchema,
    templateHash: ContentHashSchema,
    filename: Type.String({ minLength: 1, maxLength: 160 }),
    directory: Type.Optional(WorkspaceRelativePathSchema),
    values: AssetFieldsSchema
  },
  { additionalProperties: false }
);
export type CreateAssetArgs = Static<typeof CreateAssetSchema>;
export const CreateAssetValidator = Compile(Type.Tuple([CreateAssetSchema]));
export const IdentifyAssetSchema = Type.Object(
  {
    ...WorkspaceRootArgsSchema.properties,
    relativePath: WorkspaceRelativePathSchema,
    expectedHash: ContentHashSchema,
    templateId: ArtifactIdSchema,
    templateHash: ContentHashSchema
  },
  { additionalProperties: false }
);
export type IdentifyAssetArgs = Static<typeof IdentifyAssetSchema>;
export const IdentifyAssetValidator = Compile(Type.Tuple([IdentifyAssetSchema]));
export type TemplatesApi = {
  list: (args: { rootPath: string }) => Promise<TemplateList>;
  create: (args: CreateAssetArgs) => Promise<WorkspaceDocument>;
  identify: (args: IdentifyAssetArgs) => Promise<WorkspaceDocument>;
};
