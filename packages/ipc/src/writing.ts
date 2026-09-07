import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';

import {
  ArtifactIdSchema,
  ContentHashSchema,
  TextRangeSchema,
  WorkspaceRelativePathSchema,
  WritingModelSchema,
  type CandidateDetails,
  type CandidateSummary,
  type VersionSnapshot
} from '@chaptale/shared';

import { WorkspaceRootArgsSchema } from './schemas/workspace';
import type { WorkspaceDocument } from './workspace';

export const DraftRequestSchema = Type.Object(
  {
    ...WorkspaceRootArgsSchema.properties,
    candidateId: ArtifactIdSchema,
    targetPath: WorkspaceRelativePathSchema,
    expectedHash: ContentHashSchema,
    range: TextRangeSchema,
    packId: ArtifactIdSchema,
    allowStalePack: Type.Boolean(),
    model: WritingModelSchema,
    parentId: Type.Optional(ArtifactIdSchema)
  },
  { additionalProperties: false }
);
export type DraftRequest = Static<typeof DraftRequestSchema>;
export const DraftRequestValidator = Compile(Type.Tuple([DraftRequestSchema]));
export const CandidateIdArgsSchema = Type.Object(
  {
    ...WorkspaceRootArgsSchema.properties,
    candidateId: ArtifactIdSchema
  },
  { additionalProperties: false }
);
export type CandidateIdArgs = Static<typeof CandidateIdArgsSchema>;
export const CandidateIdArgsValidator = Compile(Type.Tuple([CandidateIdArgsSchema]));
export const ApplyCandidateSchema = Type.Object(
  {
    ...CandidateIdArgsSchema.properties,
    revision: Type.Integer({ minimum: 1 }),
    changeIndexes: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 1, maxItems: 2000 })
  },
  { additionalProperties: false }
);
export type ApplyCandidateArgs = Static<typeof ApplyCandidateSchema>;
export const ApplyCandidateValidator = Compile(Type.Tuple([ApplyCandidateSchema]));
export const WritingTargetSchema = Type.Object(
  {
    ...WorkspaceRootArgsSchema.properties,
    targetPath: WorkspaceRelativePathSchema
  },
  { additionalProperties: false }
);
export const WritingTargetValidator = Compile(Type.Tuple([WritingTargetSchema]));
export const SnapshotReadSchema = Type.Object(
  {
    ...WritingTargetSchema.properties,
    snapshotId: ArtifactIdSchema
  },
  { additionalProperties: false }
);
export const SnapshotReadValidator = Compile(Type.Tuple([SnapshotReadSchema]));
export type WritingApi = {
  generate: (args: DraftRequest) => Promise<CandidateDetails>;
  cancel: (args: CandidateIdArgs) => Promise<void>;
  listCandidates: (args: { rootPath: string }) => Promise<{ candidates: CandidateSummary[]; diagnostics: string[] }>;
  readCandidate: (args: CandidateIdArgs) => Promise<CandidateDetails>;
  discard: (args: CandidateIdArgs) => Promise<CandidateDetails>;
  apply: (args: ApplyCandidateArgs) => Promise<{ details: CandidateDetails; document: WorkspaceDocument }>;
  listVersions: (args: Static<typeof WritingTargetSchema>) => Promise<VersionSnapshot[]>;
  readVersion: (args: Static<typeof SnapshotReadSchema>) => Promise<{ snapshot: VersionSnapshot; content: string }>;
};
