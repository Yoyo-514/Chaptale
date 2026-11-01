import type { Entry } from './content.ts';
import { chapterOrder, type RecordPlacement, type RecordSource } from './records.ts';

/** 关系的一次建立或结束；显示文字由应用按称呼生成。 */
export type RelationMilestone = {
  id: string;
  kind: 'start' | 'end';
  source: RecordSource;
  placement: RecordPlacement;
  /** 作者标注的故事内时间，空字符串表示未标注；不参与排序。 */
  storyTime: string;
};

/** 一次关系修订保存的整份内容。 */
export interface RelationSnapshot {
  id: string;
  /** 双方资料；有方向时由第一方指向第二方，两端称呼按同一顺序。 */
  resourceIds: [string, string];
  type: string;
  directed: boolean;
  titles: [string, string];
  /** 同一发生位置内按数组顺序排列。 */
  milestones: RelationMilestone[];
}
export type RelationFields = Omit<RelationSnapshot, 'id'>;

export interface StoryRelation extends RelationSnapshot {
  revisionId: string;
  createdAt: number;
  updatedAt: number;
}

/** 新增的建立或结束 id 为 null，由应用分配。 */
export type MilestoneInput = Omit<RelationMilestone, 'id'> & { id: string | null };
export interface RelationInput extends Omit<RelationFields, 'milestones'> {
  milestones: MilestoneInput[];
}
export interface CreateRelationInput extends RelationInput {
  commandId: string;
  workId: string;
}
export interface UpdateRelationInput extends RelationInput {
  commandId: string;
  workId: string;
  relationId: string;
  expectedRevisionId: string;
}
export interface RemoveRelationInput {
  commandId: string;
  workId: string;
  relationId: string;
  expectedRevisionId: string;
}

/** 关系类型：名称、方向与默认两端称呼。 */
export interface RelationType {
  type: string;
  directed: boolean;
  titles: [string, string];
}

export const relationPresets: readonly RelationType[] = [
  { type: '师徒', directed: true, titles: ['师父', '徒弟'] },
  { type: '夫妻', directed: false, titles: ['丈夫', '妻子'] },
  { type: '朋友', directed: false, titles: ['朋友', '朋友'] },
  { type: '敌对', directed: false, titles: ['敌人', '敌人'] }
];

/** 可选类型：预设加本作品已用过的类型名，同名取预设或最早出现的称呼。 */
export function relationTypes(relations: readonly RelationFields[]): RelationType[] {
  const types = [...relationPresets];
  for (const { type, directed, titles } of relations)
    if (!types.some(item => item.type === type)) types.push({ type, directed, titles });
  return types;
}

/** 截至 asOf（章节 ID，null 为全部）是否持续；位置待定的建立或结束不参与判断，没有可判断的记录时为 undetermined。 */
export type RelationState = 'active' | 'ended' | 'undetermined';
export function relationState(
  relation: Pick<RelationFields, 'milestones'>,
  entries: readonly Entry[],
  asOf: string | null = null
): RelationState {
  const chapters = chapterOrder(entries);
  const limit = asOf === null ? chapters.length : chapters.indexOf(asOf) + 1;
  let latest: { rank: number; kind: RelationMilestone['kind'] } | null = null;
  for (const milestone of relation.milestones) {
    const { placement } = milestone;
    if (placement.kind === 'undetermined') continue;
    const rank = placement.kind === 'opening' ? -1 : chapters.indexOf(placement.chapterId);
    if (placement.kind === 'chapter' && (rank === -1 ? asOf !== null : rank >= limit)) continue;
    const effective = placement.kind === 'chapter' && rank === -1 ? chapters.length : rank;
    if (latest === null || effective >= latest.rank) latest = { rank: effective, kind: milestone.kind };
  }
  if (latest === null) return 'undetermined';
  return latest.kind === 'start' ? 'active' : 'ended';
}
