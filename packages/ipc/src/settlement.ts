import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';

import {
  ArtifactIdSchema,
  ContentHashSchema,
  WorkspaceRelativePathSchema,
  WritingModelSchema,
  type SettlementDetails,
  type SettlementList,
  type SettlementPlan
} from '@chaptale/shared';

const RootSchema = Type.Object({ rootPath: Type.String({ minLength: 1 }) }, { additionalProperties: false });
const IdSchema = Type.Object(
  { rootPath: Type.String({ minLength: 1 }), batchId: ArtifactIdSchema },
  { additionalProperties: false }
);
const PrepareSchema = Type.Object(
  {
    rootPath: Type.String({ minLength: 1 }),
    chapterPath: WorkspaceRelativePathSchema,
    packId: ArtifactIdSchema
  },
  { additionalProperties: false }
);
const StartSchema = Type.Object(
  {
    ...PrepareSchema.properties,
    batchId: ArtifactIdSchema,
    expectedHash: ContentHashSchema,
    model: WritingModelSchema,
    autoAcceptSummary: Type.Boolean()
  },
  { additionalProperties: false }
);
const ResolveSchema = Type.Object(
  {
    ...IdSchema.properties,
    revision: Type.Integer({ minimum: 1 }),
    itemId: ArtifactIdSchema,
    action: Type.Union([Type.Literal('accept'), Type.Literal('reject')]),
    editedContent: Type.Optional(Type.String({ maxLength: 10_000_000 }))
  },
  { additionalProperties: false }
);
const CompleteSchema = Type.Object(
  { ...IdSchema.properties, revision: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false }
);
export type PrepareSettlementArgs = Static<typeof PrepareSchema>;
export type StartSettlementArgs = Static<typeof StartSchema>;
export type SettlementIdArgs = Static<typeof IdSchema>;
export type ResolveSettlementArgs = Static<typeof ResolveSchema>;
export type CompleteSettlementArgs = Static<typeof CompleteSchema>;
export const SettlementValidators = {
  list: Compile(Type.Tuple([RootSchema])),
  unsettled: Compile(Type.Tuple([RootSchema])),
  prepare: Compile(Type.Tuple([PrepareSchema])),
  start: Compile(Type.Tuple([StartSchema])),
  read: Compile(Type.Tuple([IdSchema])),
  cancel: Compile(Type.Tuple([IdSchema])),
  resolve: Compile(Type.Tuple([ResolveSchema])),
  complete: Compile(Type.Tuple([CompleteSchema]))
};
export type SettlementApi = {
  list(args: { rootPath: string }): Promise<SettlementList>;
  unsettled(args: { rootPath: string }): Promise<string[]>;
  prepare(args: PrepareSettlementArgs): Promise<SettlementPlan>;
  start(args: StartSettlementArgs): Promise<SettlementDetails>;
  read(args: SettlementIdArgs): Promise<SettlementDetails>;
  cancel(args: SettlementIdArgs): Promise<void>;
  resolve(args: ResolveSettlementArgs): Promise<SettlementDetails>;
  complete(args: CompleteSettlementArgs): Promise<SettlementDetails>;
};
