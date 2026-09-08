import { validateTemplateValues, type AssetFieldValue, type AssetTemplate } from '@chaptale/shared';
import { parseDocumentFrontmatter, patchDocumentFields } from '@chaptale/shared/document-frontmatter';

export function patchRelationship(
  content: string,
  index: number | null,
  next: { to: string; type: string; note: string } | null
) {
  const head = parseDocumentFrontmatter(content);
  if (head.status !== 'ok' || head.frontmatter.kind !== 'character') throw new Error('只能修改有效角色文件中的关系');
  const original = head.frontmatter.relations;
  if (original !== undefined && !Array.isArray(original)) throw new Error('关系字段不是列表，请先修正源文件');
  const rows: unknown[] = [...(original ?? [])];
  if (index !== null && (!Number.isInteger(index) || index < 0 || index >= rows.length))
    throw new Error('关系已变化，请重新打开');
  if (next) {
    if (!next.to.trim() || !next.type.trim()) throw new Error('目标角色与关系称谓不能为空');
    if (next.to.length > 1000 || next.type.length > 200 || next.note.length > 4000) throw new Error('关系字段过长');
    const old = index === null ? undefined : rows[index];
    const row = {
      ...(old && typeof old === 'object' && !Array.isArray(old) ? old : {}),
      ...next,
      type: next.type.trim()
    };
    if (index === null) {
      if (rows.length >= 200) throw new Error('单个角色的关系不能超过 200 项');
      rows.push(row);
    } else rows[index] = row;
  } else {
    if (index === null) throw new Error('请选择要移除的关系');
    rows.splice(index, 1);
  }
  return patchDocumentFields(content, { relations: rows });
}
export function patchStoryEvent(content: string, values: Record<string, AssetFieldValue>, template: AssetTemplate) {
  const head = parseDocumentFrontmatter(content);
  if (head.status !== 'ok' || head.frontmatter.kind !== 'timeline-event') throw new Error('事件文件的类型已变化');
  const errors = validateTemplateValues(template, values);
  if (errors.length) throw new Error(errors.join('\n'));
  return patchDocumentFields(content, values);
}
