import { expect, it } from 'vitest';

import type { Entry, RelationChange, RelationSnapshot, StoryRelation } from '@chaptale/creation/contracts';

import { relationOverlaps } from '../relations';

const at = 1_793_740_000_000;
const entry = (id: string, title: string, section: Entry['section'], position: number) =>
  ({ id, title, section, kind: 'document', parentId: null, position, revisionId: `r-${id}` }) as unknown as Entry;
const entries = [
  entry('prologue', '序章', 'manuscript', 0),
  entry('first', '第一章', 'manuscript', 1),
  entry('gu', '顾长风', 'resource', 0),
  entry('shen', '沈霁', 'resource', 1)
];

function snapshot(id: string, chapterId: string, type = '师徒'): RelationSnapshot {
  return {
    id,
    resourceIds: ['gu', 'shen'],
    type,
    directed: true,
    titles: ['师父', '徒弟'],
    milestones: [
      {
        id: `m-${id}`,
        kind: 'start',
        source: { kind: 'author' },
        placement: { kind: 'chapter', chapterId },
        storyTime: ''
      }
    ]
  };
}
function change(id: string, sessionId: string, candidate: RelationSnapshot, base: RelationSnapshot | null = null) {
  return {
    id,
    workId: 'w',
    sessionId,
    target: 'relation',
    targetId: candidate.id,
    version: 'v',
    order: 0,
    authorEdited: false,
    conflicts: [],
    status: 'pending',
    updatedAt: at,
    base,
    candidate,
    basis: ''
  } as unknown as RelationChange;
}
const formal = (relation: RelationSnapshot) =>
  ({ ...relation, revisionId: 'rev', createdAt: at, updatedAt: at }) as StoryRelation;

it('新增关系与同一对资料的正式同类关系重合时提示已有关系及起止', () => {
  const proposed = change('c1', 'b', { ...snapshot('n1', 'first'), resourceIds: ['shen', 'gu'] });
  expect(relationOverlaps(proposed, [formal(snapshot('old', 'prologue'))], [proposed], entries, [])).toEqual([
    '沈霁与顾长风已有师徒关系（《序章》起）'
  ]);
});

it('另一个会话提出同一对资料的同类新关系时提示，本会话与其他类型不提示', () => {
  const mine = change('c1', 'b', snapshot('n1', 'first'));
  const sameSession = change('c2', 'b', snapshot('n2', 'prologue'));
  const otherType = change('c3', 'a', snapshot('n3', 'prologue', '朋友'));
  expect(relationOverlaps(mine, [], [mine, sameSession, otherType], entries, [])).toEqual([]);
  const other = change('c4', 'a', snapshot('n4', 'prologue'));
  expect(relationOverlaps(mine, [], [mine, other], entries, [])).toEqual(['另一个会话也提出了顾长风与沈霁的师徒关系']);
});

it('修改或移除已有关系的候选不提示', () => {
  const base = snapshot('old', 'prologue');
  const relations = [formal(base)];
  expect(relationOverlaps(change('c1', 'b', snapshot('old', 'first'), base), relations, [], entries, [])).toEqual([]);
});
