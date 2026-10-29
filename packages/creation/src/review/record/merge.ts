import type { RecordSnapshot, StoryRecord } from '../../contracts/records.ts';
import type { RecordChange, RecordReviewView } from '../../contracts/review.ts';

const fields = ['text', 'resourceIds', 'source', 'placement', 'storyTime'] as const;

/** 事件按整字段合并正式稿的后续修改：只有一方改过的字段采用改过的值，双方改得不同记为冲突。 */
export function mergeRecord(change: RecordChange, current: StoryRecord | null): RecordReviewView {
  const conflicts = [...change.conflicts];
  const candidate: RecordSnapshot = { ...change.candidate };
  if (change.base && current) {
    for (const field of fields) {
      const original = display(change.base[field]),
        official = display(current[field]),
        proposed = display(candidate[field]);
      if (official === original || official === proposed) continue;
      if (proposed === original) Object.assign(candidate, { [field]: current[field] });
      else conflicts.push({ field, base: original, current: official, proposed });
    }
  }
  return { change, current, candidate, conflicts };
}

export function recordSnapshot(record: StoryRecord): RecordSnapshot {
  const { id, resourceIds, text, source, placement, storyTime } = record;
  return { id, resourceIds, text, source, placement, storyTime };
}

/** 文本字段原样显示，其余字段为 JSON，由界面换成章节与资料名称。 */
function display(value: RecordSnapshot[(typeof fields)[number]]): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
