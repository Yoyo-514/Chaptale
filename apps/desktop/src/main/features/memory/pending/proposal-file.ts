import { createHash } from 'node:crypto';

import type { MemoryPendingProposal, MemoryProposalType } from '@chaptale/shared';
import { parseDocumentFrontmatter, patchDocumentFields } from '@chaptale/shared/document-frontmatter';

import type { FrontmatterParser } from '../../../core/frontmatter/types';

const proposalTypes: ReadonlySet<string> = new Set(['create', 'update', 'archive']);

/** 内容指纹统一口径：sha1 十六进制，带前缀便于人眼识别算法。 */
export function hashContent(content: string): string {
  return `sha1:${createHash('sha1').update(content, 'utf8').digest('hex')}`;
}

/** 提议正文经 frontmatter 解析往返不保真尾部空白；应用写盘时统一补末尾换行。 */
export function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`;
}

/** 提议文件序列化：受控字段集合，字符串值一律 JSON 转义保证 YAML 安全。 */
export function renderProposalFile(proposal: MemoryPendingProposal): string {
  const lines = [
    '---',
    'kind: proposal',
    `id: ${JSON.stringify(proposal.id)}`,
    `proposalType: ${proposal.proposalType}`,
    `title: ${JSON.stringify(proposal.title)}`,
    `reason: ${JSON.stringify(proposal.reason)}`,
    `targetPath: ${JSON.stringify(proposal.targetPath)}`,
    ...(proposal.contentHash ? [`contentHash: ${JSON.stringify(proposal.contentHash)}`] : []),
    ...(proposal.relatedTo?.length
      ? [`relatedTo: [${proposal.relatedTo.map(item => JSON.stringify(item)).join(', ')}]`]
      : []),
    `source: ${JSON.stringify(proposal.source)}`,
    `createdAt: ${JSON.stringify(proposal.createdAt)}`,
    '---',
    ''
  ];

  return `${lines.join('\n')}${proposal.content}${proposal.content.endsWith('\n') || !proposal.content ? '' : '\n'}`;
}

export function parseProposalFile(raw: string, parse: FrontmatterParser): MemoryPendingProposal {
  const { frontmatter, body } = parse(raw);

  const id = expectString(frontmatter, 'id');
  const proposalType = expectString(frontmatter, 'proposalType');

  if (!proposalTypes.has(proposalType)) {
    throw new Error(`未知提议类型：${proposalType}`);
  }

  const relatedTo = Array.isArray(frontmatter.relatedTo)
    ? frontmatter.relatedTo.filter((item): item is string => typeof item === 'string')
    : undefined;

  return {
    id,
    proposalType: proposalType as MemoryProposalType,
    title: expectString(frontmatter, 'title'),
    reason: expectString(frontmatter, 'reason'),
    targetPath: expectString(frontmatter, 'targetPath'),
    ...(typeof frontmatter.contentHash === 'string' ? { contentHash: frontmatter.contentHash } : {}),
    ...(relatedTo?.length ? { relatedTo } : {}),
    source: expectString(frontmatter, 'source'),
    createdAt: expectString(frontmatter, 'createdAt'),
    content: body.replace(/^\n/, '')
  };
}

function expectString(frontmatter: Record<string, unknown>, key: string): string {
  const value = frontmatter[key];

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`frontmatter 缺少字段：${key}`);
  }

  return value;
}

/**
 * 文本级把 frontmatter 的 status 置为 archived：
 * 已有 status 行则替换，有 frontmatter 无 status 则追加，无 frontmatter 则头部新建块——
 * 除此之外一字不动，保留作者文件的原始格式。
 */
export function setFrontmatterStatusArchived(content: string): string {
  const head = parseDocumentFrontmatter(content);
  if (head.status === 'invalid') throw new Error('请先修正资产元数据');
  if (head.status === 'none') {
    const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    return patchDocumentFields(`${bom}${eol}${content.slice(bom.length)}`, { status: 'archived' });
  }
  return patchDocumentFields(content, { status: 'archived' });
}
