import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';

import type { PersonaFrontmatter } from './personas';
import type { ReviewAgentType, ReviewIssues } from './reviews';
import { WorkspaceRelativePathSchema } from './workspace';
import { ArtifactIdSchema, ContentHashSchema, WritingModelSchema } from './writing';

export const REVIEWERS = [
  { id: 'continuity-reviewer', kind: 'continuity', label: '连贯性' },
  { id: 'character-reviewer', kind: 'character', label: '人物' },
  { id: 'style-reviewer', kind: 'style', label: '文风' }
] as const;
export const ReviewerIdSchema = Type.String({ pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 64 });
export const ReviewOutputSchema = Type.Union([
  Type.Literal('continuity-issues'),
  Type.Literal('character-issues'),
  Type.Literal('style-issues'),
  Type.Literal('custom-issues')
]);
export type ReviewOutput = Static<typeof ReviewOutputSchema>;
export type ReviewerOption = { id: string; label: string; kind: ReviewAgentType; output: ReviewOutput };
export function reviewOutputKind(output: string | undefined): ReviewAgentType | undefined {
  switch (output) {
    case 'continuity-issues':
      return 'continuity';
    case 'character-issues':
      return 'character';
    case 'style-issues':
      return 'style';
    case 'custom-issues':
      return 'custom';
  }
}
export function reviewerOption(persona: PersonaFrontmatter): ReviewerOption | undefined {
  const kind = reviewOutputKind(persona.output);
  if (persona.enabled === false || persona.type !== 'review' || persona.execution !== 'task' || !kind) return;
  return { id: persona.id, label: persona.name, kind, output: persona.output as ReviewOutput };
}
export const IssueStatusSchema = Type.Union([Type.Literal('open'), Type.Literal('resolved'), Type.Literal('ignored')]);
export type IssueStatus = Static<typeof IssueStatusSchema>;
export const ReviewJobSchema = Type.Object(
  {
    id: ArtifactIdSchema,
    personaId: ReviewerIdSchema,
    personaName: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    outputSchema: Type.Optional(ReviewOutputSchema),
    targetPath: WorkspaceRelativePathSchema,
    candidateId: Type.Optional(ArtifactIdSchema),
    candidateRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    baselineHash: ContentHashSchema,
    text: Type.String({ maxLength: 10_000_000 }),
    packId: Type.Optional(ArtifactIdSchema),
    model: WritingModelSchema,
    memoryRefs: Type.Array(Type.String()),
    excludedSources: Type.Array(Type.String()),
    status: Type.Union([
      Type.Literal('running'),
      Type.Literal('done'),
      Type.Literal('failed'),
      Type.Literal('cancelled')
    ]),
    runId: Type.Optional(ArtifactIdSchema),
    outputRef: Type.Optional(WorkspaceRelativePathSchema),
    outputHash: Type.Optional(ContentHashSchema),
    error: Type.Optional(Type.String()),
    createdAt: Type.String(),
    updatedAt: Type.String()
  },
  { additionalProperties: false }
);
export const ReviewJobValidator = Compile(ReviewJobSchema);
export type ReviewJob = Static<typeof ReviewJobSchema>;
export type ReviewJobSummary = Omit<ReviewJob, 'text'>;
export const ReviewStateSchema = Type.Object(
  {
    outputHash: ContentHashSchema,
    issues: Type.Record(
      Type.String({ pattern: '^[0-9]+$' }),
      Type.Object(
        {
          status: IssueStatusSchema,
          updatedAt: Type.String()
        },
        { additionalProperties: false }
      )
    )
  },
  { additionalProperties: false }
);
export const ReviewStateValidator = Compile(ReviewStateSchema);
export type ReviewState = Static<typeof ReviewStateSchema>;
export type ReviewDetails = { job: ReviewJob; result: ReviewIssues | null; state: ReviewState | null };
export type ReviewMark = { id: string; from: number; to: number; severity: 'high' | 'medium' | 'low' };
