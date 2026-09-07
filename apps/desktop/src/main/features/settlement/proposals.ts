import { stringify } from 'yaml';

import {
  applyRewriteEdits,
  ChapterSettlementValidator,
  normalizeDocumentText,
  type SettlementBatch,
  type SettlementItem
} from '@chaptale/shared';
import { parseDocumentFrontmatter, patchDocumentFields } from '@chaptale/shared/document-frontmatter';

import { readDocumentSnapshot } from '../workspace/read-document';
import { authorPath, hash, summaryPath } from './files';

export function summaryContent(batch: SettlementBatch, body: string, acceptedAt?: string) {
  return `---\n${stringify({
    kind: 'chapter-summary',
    title: batch.chapterTitle,
    chapterKey: batch.chapterKey,
    chapter: `[[${batch.chapterPath}]]`,
    sourcePath: batch.chapterPath,
    sourceHash: batch.chapterHash,
    ...(batch.chapterSourceId ? { sourceId: batch.chapterSourceId } : {}),
    ...(batch.chapterOrder !== undefined ? { order: batch.chapterOrder } : {}),
    settlementId: batch.id,
    ...(acceptedAt ? { acceptedAt } : {})
  })}---\n\n${body.trim()}\n`;
}
export async function buildSettlementItems(rootPath: string, batch: SettlementBatch, output: unknown) {
  if (!ChapterSettlementValidator.Check(output)) throw new Error('结算输出不符合协议');
  const items: SettlementItem[] = [
    {
      id: 'summary',
      category: 'summary',
      title: '章节摘要',
      reason: '本章已经发生的事件',
      targetPath: summaryPath(batch.chapterKey),
      ...(batch.summaryBaseline ? { baseline: batch.summaryBaseline } : {}),
      proposedContent: summaryContent(batch, output.summary),
      status: 'pending'
    }
  ];
  const seen = new Set<string>();
  for (const [index, update] of output.updates.entries()) {
    const source = batch.sources.find(value => value.sourcePath === update.sourcePath);
    if (!source || !['character', 'plot-thread'].includes(source.kind ?? '') || seen.has(update.sourcePath))
      throw new Error('结算只能更新参考中的角色、伏笔，每个资产只能一项提议');
    seen.add(update.sourcePath);
    await authorPath(rootPath, update.sourcePath);
    const document = await readDocumentSnapshot({
      rootPath,
      relativePath: update.sourcePath,
      maxBytes: 8 * 1024 * 1024
    });
    if (document.contentHash !== source.contentHash) throw new Error(`${update.sourcePath} 已变化，请重新结算`);
    if (document.head.status !== 'ok' || document.head.frontmatter.kind !== source.kind)
      throw new Error('资产种类已变化');
    let content = document.content;
    if (update.edits) {
      const text = normalizeDocumentText(content);
      const start = text.length - normalizeDocumentText(document.head.body).length;
      content = applyRewriteEdits(content, update.edits, [{ from: start, to: text.length, text: text.slice(start) }]);
    }
    if (update.thread) {
      if (source.kind !== 'plot-thread') throw new Error('只有伏笔线可以更新推进状态');
      content = patchDocumentFields(content, update.thread);
    }
    if (content === document.content) throw new Error('资产提议没有有效改动');
    items.push({
      id: `asset-${index}`,
      category: source.kind as 'character' | 'plot-thread',
      title: typeof document.head.frontmatter.title === 'string' ? document.head.frontmatter.title : update.sourcePath,
      reason: update.reason,
      targetPath: update.sourcePath,
      baseline: { content: document.content, contentHash: document.contentHash },
      proposedContent: content,
      status: 'pending'
    });
  }
  for (const [index, event] of output.events.entries()) {
    const id = `event-${index}`;
    const content = `---\n${stringify({
      id: `${batch.id}-${id}`,
      kind: 'world',
      category: 'timeline',
      title: event.title,
      when: event.when,
      participants: event.participants,
      chapter: `[[${batch.chapterPath}]]`,
      settlementId: batch.id
    })}---\n\n${event.description.trim()}\n`;
    items.push({
      id,
      category: 'timeline',
      title: event.title,
      reason: '本章时间线事件',
      targetPath: `${batch.worldDirectory}/时间线/${batch.id}-${id}.md`,
      proposedContent: content,
      status: 'pending'
    });
  }
  if (items.reduce((size, item) => size + Buffer.byteLength(JSON.stringify(item)), 0) > 24 * 1024 * 1024)
    throw new Error('结算提议超过 24 MiB，请缩小参考范围');
  return items;
}
export function acceptanceContent(
  batch: SettlementBatch,
  item: SettlementItem,
  edited: string | undefined,
  at: string
) {
  const content = edited ?? item.proposedContent;
  if (!content.isWellFormed() || content.includes('\0') || Buffer.byteLength(content) > 8 * 1024 * 1024)
    throw new Error('接受内容无效或过长');
  const head = parseDocumentFrontmatter(content);
  const original = parseDocumentFrontmatter(item.proposedContent);
  if (head.status !== 'ok' || original.status !== 'ok') throw new Error('元数据不可损坏，请修正后接受');
  if (item.category === 'summary') {
    if (!head.body.trim() || head.body.length > 16000) throw new Error('摘要正文为空或过长');
    return summaryContent(batch, head.body, at);
  }
  for (const key of ['id', 'kind', 'template', 'templateId', 'templateHash', 'settlementId']) {
    if (JSON.stringify(head.frontmatter[key]) !== JSON.stringify(original.frontmatter[key]))
      throw new Error(`结算提议不能改变 ${key}`);
  }
  if (item.baseline && hash(item.baseline.content) !== item.baseline.contentHash) throw new Error('资产基线已损坏');
  return content;
}
