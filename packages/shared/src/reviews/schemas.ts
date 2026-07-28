import { Type, type Static, type TSchema } from 'typebox';
import { Check } from 'typebox/value';

export type ReviewAgentType = 'continuity' | 'character' | 'style';

export const ReviewPositionSchema = Type.Object(
  {
    start: Type.Optional(Type.Integer({ minimum: 0 })),
    end: Type.Optional(Type.Integer({ minimum: 0 }))
  },
  { additionalProperties: false }
);

const reviewIssueBase = {
  severity: Type.Union([Type.Literal('high'), Type.Literal('medium'), Type.Literal('low')]),
  quote: Type.String({ minLength: 1 }),
  reason: Type.String({ minLength: 1 }),
  suggestion: Type.String({ minLength: 1 }),
  position: Type.Optional(ReviewPositionSchema)
} as const;

export const ContinuityIssueSchema = Type.Object(
  {
    ...reviewIssueBase,
    agentType: Type.Literal('continuity'),
    type: Type.Union([
      Type.Literal('timeline'),
      Type.Literal('world_rule'),
      Type.Literal('item_state'),
      Type.Literal('fact_conflict'),
      Type.Literal('premature_reveal')
    ])
  },
  { additionalProperties: false }
);

export const CharacterIssueSchema = Type.Object(
  {
    ...reviewIssueBase,
    agentType: Type.Literal('character'),
    characterId: Type.Optional(Type.String({ minLength: 1 })),
    type: Type.Union([
      Type.Literal('ooc'),
      Type.Literal('voice_mismatch'),
      Type.Literal('knowledge_leak'),
      Type.Literal('emotion_break'),
      Type.Literal('weak_motivation')
    ]),
    expectedBehavior: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

export const StyleIssueSchema = Type.Object(
  {
    ...reviewIssueBase,
    agentType: Type.Literal('style'),
    type: Type.Union([
      Type.Literal('style_drift'),
      Type.Literal('flat_rhythm'),
      Type.Literal('over_explaining'),
      Type.Literal('mechanical_emotion'),
      Type.Literal('unnatural_dialogue')
    ]),
    rewriteSuggestion: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

function createReviewIssuesSchema<TIssue extends TSchema>(issueSchema: TIssue) {
  return Type.Object(
    {
      issues: Type.Array(issueSchema),
      summary: Type.String({ minLength: 1 })
    },
    { additionalProperties: false }
  );
}

export const ContinuityIssuesSchema = createReviewIssuesSchema(ContinuityIssueSchema);
export const CharacterIssuesSchema = createReviewIssuesSchema(CharacterIssueSchema);
export const StyleIssuesSchema = createReviewIssuesSchema(StyleIssueSchema);

export type ContinuityIssue = Static<typeof ContinuityIssueSchema>;
export type CharacterIssue = Static<typeof CharacterIssueSchema>;
export type StyleIssue = Static<typeof StyleIssueSchema>;

export type ReviewIssue = ContinuityIssue | CharacterIssue | StyleIssue;

export type ContinuityIssues = Static<typeof ContinuityIssuesSchema>;
export type CharacterIssues = Static<typeof CharacterIssuesSchema>;
export type StyleIssues = Static<typeof StyleIssuesSchema>;

export type ReviewIssues = ContinuityIssues | CharacterIssues | StyleIssues;

export function decodeReviewIssues(kind: 'continuity', value: unknown): ContinuityIssues | undefined;
export function decodeReviewIssues(kind: 'character', value: unknown): CharacterIssues | undefined;
export function decodeReviewIssues(kind: 'style', value: unknown): StyleIssues | undefined;
export function decodeReviewIssues(kind: ReviewAgentType, value: unknown): ReviewIssues | undefined {
  switch (kind) {
    case 'continuity':
      return Check(ContinuityIssuesSchema, value) ? value : undefined;
    case 'character':
      return Check(CharacterIssuesSchema, value) ? value : undefined;
    case 'style':
      return Check(StyleIssuesSchema, value) ? value : undefined;
  }
}
