import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';

import { RewriteEditsSchema } from './rewrite';
import { WorkspaceRelativePathSchema } from './workspace';
import { ArtifactIdSchema, ContentHashSchema, WritingModelSchema } from './writing';

const ThreadFieldsSchema = Type.Object(
  {
    status: Type.Optional(
      Type.Union([
        Type.Literal('planted'),
        Type.Literal('advanced'),
        Type.Literal('resolved'),
        Type.Literal('abandoned')
      ])
    ),
    advances: Type.Optional(Type.Array(Type.String({ maxLength: 4000 }), { maxItems: 100 }))
  },
  { additionalProperties: false }
);
export const ChapterSettlementSchema = Type.Object(
  {
    summary: Type.String({ minLength: 1, maxLength: 16000, pattern: '\\S' }),
    updates: Type.Array(
      Type.Object(
        {
          sourcePath: WorkspaceRelativePathSchema,
          reason: Type.String({ minLength: 1, maxLength: 4000 }),
          edits: Type.Optional(RewriteEditsSchema),
          thread: Type.Optional(ThreadFieldsSchema)
        },
        { additionalProperties: false }
      ),
      { maxItems: 40 }
    ),
    events: Type.Array(
      Type.Object(
        {
          title: Type.String({ minLength: 1, maxLength: 200 }),
          when: Type.String({ maxLength: 200 }),
          description: Type.String({ minLength: 1, maxLength: 8000 }),
          participants: Type.Array(Type.String({ maxLength: 1000 }), { maxItems: 40 })
        },
        { additionalProperties: false }
      ),
      { maxItems: 40 }
    )
  },
  { additionalProperties: false }
);
export type ChapterSettlement = Static<typeof ChapterSettlementSchema>;
export const ChapterSettlementValidator = Compile(ChapterSettlementSchema);
const SourceSchema = Type.Object({
  sourcePath: WorkspaceRelativePathSchema,
  contentHash: ContentHashSchema,
  kind: Type.Optional(Type.String())
});
const SnapshotSchema = Type.Object({
  content: Type.String({ maxLength: 10_000_000 }),
  contentHash: ContentHashSchema
});
export const SettlementItemSchema = Type.Object(
  {
    id: ArtifactIdSchema,
    category: Type.Union([
      Type.Literal('summary'),
      Type.Literal('character'),
      Type.Literal('plot-thread'),
      Type.Literal('timeline')
    ]),
    title: Type.String(),
    reason: Type.String(),
    targetPath: WorkspaceRelativePathSchema,
    baseline: Type.Optional(SnapshotSchema),
    proposedContent: Type.String({ maxLength: 10_000_000 }),
    status: Type.Union([Type.Literal('pending'), Type.Literal('accepted'), Type.Literal('rejected')]),
    decidedAt: Type.Optional(Type.String()),
    acceptedHash: Type.Optional(ContentHashSchema),
    editedContent: Type.Optional(Type.String({ maxLength: 10_000_000 })),
    applying: Type.Optional(
      Type.Object({
        content: Type.String({ maxLength: 10_000_000 }),
        contentHash: ContentHashSchema,
        at: Type.String()
      })
    )
  },
  { additionalProperties: false }
);
export type SettlementItem = Static<typeof SettlementItemSchema>;
export const SettlementBatchSchema = Type.Object(
  {
    id: ArtifactIdSchema,
    revision: Type.Integer({ minimum: 1 }),
    status: Type.Union([
      Type.Literal('generating'),
      Type.Literal('ready'),
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('cancelled')
    ]),
    chapterPath: WorkspaceRelativePathSchema,
    chapterKey: Type.String({ pattern: '^[a-f0-9]{24}$' }),
    chapterHash: ContentHashSchema,
    chapterTitle: Type.String(),
    chapterOrder: Type.Optional(Type.Number()),
    chapterSourceId: Type.Optional(Type.String()),
    packId: ArtifactIdSchema,
    personaId: Type.String(),
    model: WritingModelSchema,
    autoAcceptSummary: Type.Boolean(),
    sources: Type.Array(SourceSchema, { maxItems: 200 }),
    scenes: Type.Array(SourceSchema, { maxItems: 100 }),
    worldDirectory: WorkspaceRelativePathSchema,
    summaryBaseline: Type.Optional(SnapshotSchema),
    items: Type.Array(SettlementItemSchema, { maxItems: 81 }),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    completedAt: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
    runId: Type.Optional(ArtifactIdSchema),
    outputRef: Type.Optional(WorkspaceRelativePathSchema),
    outputHash: Type.Optional(ContentHashSchema),
    completing: Type.Optional(
      Type.Array(
        Type.Object({
          sourcePath: WorkspaceRelativePathSchema,
          beforeHash: ContentHashSchema,
          beforeContent: Type.String({ maxLength: 10_000_000 }),
          afterHash: ContentHashSchema,
          content: Type.String({ maxLength: 10_000_000 })
        }),
        { maxItems: 100 }
      )
    )
  },
  { additionalProperties: false }
);
export type SettlementBatch = Static<typeof SettlementBatchSchema>;
export const SettlementBatchValidator = Compile(SettlementBatchSchema);
export type SettlementSummary = Pick<
  SettlementBatch,
  | 'id'
  | 'revision'
  | 'status'
  | 'chapterPath'
  | 'chapterTitle'
  | 'chapterHash'
  | 'chapterSourceId'
  | 'createdAt'
  | 'updatedAt'
  | 'error'
> & { pending: number; targets: string[] };
export type SettlementList = { batches: SettlementSummary[]; diagnostics: string[] };
export type SettlementDetails = { batch: SettlementBatch; stale: boolean; conflicts: string[] };
export type SettlementPlan = {
  chapterPath: string;
  chapterTitle: string;
  expectedHash: string;
  packId: string;
  scenePaths: string[];
  sources: string[];
  tokens: number;
};
