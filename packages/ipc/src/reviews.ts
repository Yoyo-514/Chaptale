import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';

import {
  ArtifactIdSchema,
  ContentHashSchema,
  ReviewerIdSchema,
  WritingModelSchema,
  WorkspaceRelativePathSchema,
  IssueStatusSchema,
  type ReviewDetails,
  type ReviewJobSummary
} from '@chaptale/shared';

import { WorkspaceRootArgsSchema } from './schemas/workspace';

export const ReviewRunSchema = Type.Object(
  {
    ...WorkspaceRootArgsSchema.properties,
    requestId: ArtifactIdSchema,
    personaId: ReviewerIdSchema,
    targetPath: WorkspaceRelativePathSchema,
    expectedHash: ContentHashSchema,
    candidateId: Type.Optional(ArtifactIdSchema),
    candidateRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    packId: Type.Optional(ArtifactIdSchema),
    allowStalePack: Type.Boolean(),
    model: WritingModelSchema
  },
  { additionalProperties: false }
);
export type ReviewRunArgs = Static<typeof ReviewRunSchema>;
export const ReviewRunValidator = Compile(Type.Tuple([ReviewRunSchema]));
export const ReviewIdSchema = Type.Object(
  {
    ...WorkspaceRootArgsSchema.properties,
    requestId: ArtifactIdSchema
  },
  { additionalProperties: false }
);
export type ReviewIdArgs = Static<typeof ReviewIdSchema>;
export const ReviewIdValidator = Compile(Type.Tuple([ReviewIdSchema]));
export const ResolveIssueSchema = Type.Object(
  {
    ...ReviewIdSchema.properties,
    issueIndexes: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 1, maxItems: 1000 }),
    status: IssueStatusSchema
  },
  { additionalProperties: false }
);
export type ResolveIssueArgs = Static<typeof ResolveIssueSchema>;
export const ResolveIssueValidator = Compile(Type.Tuple([ResolveIssueSchema]));
export type ReviewsApi = {
  run: (args: ReviewRunArgs) => Promise<ReviewDetails>;
  cancel: (args: ReviewIdArgs) => Promise<void>;
  list: (args: { rootPath: string }) => Promise<{ jobs: ReviewJobSummary[]; diagnostics: string[] }>;
  read: (args: ReviewIdArgs) => Promise<ReviewDetails>;
  resolve: (args: ResolveIssueArgs) => Promise<ReviewDetails>;
};
