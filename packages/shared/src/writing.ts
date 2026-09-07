import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';

import { WorkspaceRelativePathSchema } from './workspace';

export const ArtifactIdSchema = Type.String({ pattern: '^[a-zA-Z0-9-]{1,80}$' });
export const ContentHashSchema = Type.String({ pattern: '^[a-f0-9]{64}$' });
export const WritingModelSchema = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 200 }),
    modelId: Type.String({ minLength: 1, maxLength: 200 })
  },
  { additionalProperties: false }
);
export type WritingModel = Static<typeof WritingModelSchema>;
export const TextRangeSchema = Type.Object(
  {
    from: Type.Integer({ minimum: 0 }),
    to: Type.Integer({ minimum: 0 })
  },
  { additionalProperties: false }
);
export const CandidateStatusSchema = Type.Union([
  Type.Literal('preparing'),
  Type.Literal('generating'),
  Type.Literal('ready'),
  Type.Literal('partially-accepted'),
  Type.Literal('accepted'),
  Type.Literal('discarded'),
  Type.Literal('stale'),
  Type.Literal('failed'),
  Type.Literal('cancelled')
]);
export type CandidateStatus = Static<typeof CandidateStatusSchema>;
export const CandidateAcceptanceSchema = Type.Object({
  at: Type.String(),
  beforeHash: ContentHashSchema,
  afterHash: ContentHashSchema,
  changes: Type.Integer({ minimum: 1 })
});
export const CandidateSchema = Type.Object(
  {
    id: ArtifactIdSchema,
    revision: Type.Integer({ minimum: 1 }),
    status: CandidateStatusSchema,
    targetPath: WorkspaceRelativePathSchema,
    baselineHash: ContentHashSchema,
    baselineContent: Type.String({ maxLength: 10_000_000 }),
    proposedContent: Type.String({ maxLength: 12_000_000 }),
    range: TextRangeSchema,
    goal: Type.String({ maxLength: 20000 }),
    packId: ArtifactIdSchema,
    personaId: Type.String(),
    model: WritingModelSchema,
    usedStalePack: Type.Boolean(),
    runId: Type.Optional(Type.String()),
    outputRef: Type.Optional(WorkspaceRelativePathSchema),
    parentId: Type.Optional(ArtifactIdSchema),
    reviewRef: Type.Optional(
      Type.Object({
        requestId: ArtifactIdSchema,
        outputHash: ContentHashSchema,
        issueIndexes: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 1, maxItems: 100 }),
        sourceHash: ContentHashSchema
      })
    ),
    error: Type.Optional(Type.String()),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    acceptances: Type.Array(CandidateAcceptanceSchema),
    applying: Type.Optional(
      Type.Object({
        content: Type.String({ maxLength: 12_000_000 }),
        afterHash: ContentHashSchema,
        changes: Type.Integer({ minimum: 1 }),
        at: Type.String()
      })
    )
  },
  { additionalProperties: false }
);
export type Candidate = Static<typeof CandidateSchema>;
export const CandidateValidator = Compile(CandidateSchema);
export type CandidateSummary = Pick<
  Candidate,
  | 'id'
  | 'revision'
  | 'status'
  | 'targetPath'
  | 'goal'
  | 'personaId'
  | 'packId'
  | 'createdAt'
  | 'updatedAt'
  | 'error'
  | 'runId'
>;
export type CandidateChange = { fromA: number; toA: number; fromB: number; toB: number };
export type CandidateDetails = { candidate: Candidate; changes: CandidateChange[] };
export const VersionSnapshotSchema = Type.Object(
  {
    id: ArtifactIdSchema,
    targetPath: WorkspaceRelativePathSchema,
    contentHash: ContentHashSchema,
    contentPath: WorkspaceRelativePathSchema,
    reason: Type.Union([
      Type.Literal('accepted'),
      Type.Literal('final'),
      Type.Literal('settlement'),
      Type.Literal('rollback')
    ]),
    createdAt: Type.String(),
    candidateId: Type.Optional(ArtifactIdSchema)
  },
  { additionalProperties: false }
);
export type VersionSnapshot = Static<typeof VersionSnapshotSchema>;
export const VersionSnapshotValidator = Compile(VersionSnapshotSchema);

export const DraftMarkdownSchema = Type.String({ minLength: 1, maxLength: 1_000_000, pattern: '\\S' });

export function normalizeDocumentText(content: string) {
  return content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

/** 范围使用编辑器的 UTF-16/LF 坐标；未触及的原始 BOM、换行与正文保持不变。 */
export function applyDocumentEdits(content: string, edits: readonly { from: number; to: number; insert: string }[]) {
  const normalized = normalizeDocumentText(content);
  const ordered = [...edits];
  // oxlint-disable-next-line unicorn/no-array-sort
  ordered.sort((a, b) => a.from - b.from || a.to - b.to);
  let previous = -1;
  for (const edit of ordered) {
    if (
      !Number.isInteger(edit.from) ||
      !Number.isInteger(edit.to) ||
      edit.from < 0 ||
      edit.from < previous ||
      edit.to < edit.from ||
      edit.to > normalized.length
    ) {
      throw new Error('修改范围越界或重叠');
    }
    for (const position of [edit.from, edit.to]) {
      if (
        position > 0 &&
        /[\uD800-\uDBFF]/.test(normalized[position - 1]!) &&
        /[\uDC00-\uDFFF]/.test(normalized[position] ?? '')
      ) {
        throw new Error('修改范围不能截断 Unicode 字符');
      }
    }
    previous = edit.to;
  }
  const separators = [...content.matchAll(/\r\n?|\n/g)].map(match => match[0]);
  const counts = new Map<string, number>();
  for (const separator of separators) counts.set(separator, (counts.get(separator) ?? 0) + 1);
  let preferred = '\n';
  let maximum = 0;
  for (const [separator, count] of counts)
    if (count > maximum) {
      maximum = count;
      preferred = separator;
    }
  const bom = content.startsWith('\uFEFF') ? 1 : 0;
  let rawPosition = bom;
  let normalizedPosition = 0;
  const advance = (to: number) => {
    while (normalizedPosition < to) {
      if (content[rawPosition] === '\r' && content[rawPosition + 1] === '\n') rawPosition += 1;
      rawPosition += 1;
      normalizedPosition += 1;
    }
    return rawPosition;
  };
  const parts: string[] = [];
  let cursor = 0;
  for (const edit of ordered) {
    const from = advance(edit.from);
    const to = advance(edit.to);
    parts.push(content.slice(cursor, from), edit.insert.replace(/\r\n?|\n/g, preferred));
    cursor = to;
  }
  parts.push(content.slice(cursor));
  return parts.join('');
}
