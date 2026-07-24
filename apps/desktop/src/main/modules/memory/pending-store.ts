import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type {
  MemoryPendingAction,
  MemoryPendingDiagnostic,
  MemoryPendingListResult,
  MemoryPendingProposal,
  MemoryPendingResolveResult,
  MemoryProposalType
} from '@chaptale/shared';

import type { FrontmatterParser } from '../personas/registry';
import { resolveWorkspaceMemoryPaths } from './paths';

export type MemoryPendingStoreOptions = {
  resolveCwd: () => Promise<string> | string;
  parseFrontmatter: FrontmatterParser;
};

export type MemoryProposalDraft = {
  proposalType: MemoryProposalType;
  title: string;
  reason: string;
  /** workspace 相对路径；写入前经边界校验。 */
  targetPath: string;
  relatedTo?: string[];
  source: string;
  /** create/update 必填；archive 不带。 */
  content?: string;
};

/** 内容指纹统一口径：sha1 十六进制，带前缀便于人眼识别算法。 */
export function hashContent(content: string): string {
  return `sha1:${createHash('sha1').update(content, 'utf8').digest('hex')}`;
}

/**
 * pending 提议存储：`.chaptale/memory/pending/` 的唯一读写方。
 *
 * 提议全生命周期（新增/列表/接受/拒绝/归档）集中于此，工具与 IPC 都只是入口——
 * 保证 changed 事件在任何入口写入后都能统一触发。
 *
 * 接受语义（MC1 过渡形态）：
 * - create：落点不存在才写入（被占用即冲突，不覆盖作者文件）；
 * - update：contentHash 复核当前文件，不符即冲突（作者已改过，提议过期）；
 * - archive：文本级改写目标 frontmatter 的 status 为 archived（保留原格式，不删文件）。
 * 冲突一律保留提议由作者定夺，不做自动三方合并。
 */
export class MemoryPendingStore {
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: MemoryPendingStoreOptions) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 校验 targetPath 合法性：必须落在 workspace 内，且不得指向 .chaptale 运行时数据区。 */
  private async resolveTargetPath(targetPath: string): Promise<{ cwd: string; absolute: string } | null> {
    const cwd = await this.options.resolveCwd();
    const absolute = path.resolve(cwd, targetPath);

    if (absolute !== cwd && !absolute.startsWith(cwd + path.sep)) {
      return null;
    }

    if (absolute.startsWith(path.join(cwd, '.chaptale') + path.sep)) {
      return null;
    }

    return { cwd, absolute };
  }

  /** 新增提议：update/archive 会读取目标文件计算 contentHash；返回提议 id。 */
  async add(draft: MemoryProposalDraft): Promise<MemoryPendingProposal> {
    const resolved = await this.resolveTargetPath(draft.targetPath);

    if (!resolved) {
      throw new Error(`目标路径不合法（必须在作品内且不得指向 .chaptale）：${draft.targetPath}`);
    }

    let contentHash: string | undefined;

    if (draft.proposalType === 'update' || draft.proposalType === 'archive') {
      let current: string;

      try {
        current = await fs.readFile(resolved.absolute, 'utf8');
      } catch {
        throw new Error(`目标文件不存在，无法提议 ${draft.proposalType}：${draft.targetPath}`);
      }

      contentHash = hashContent(current);
    } else {
      // create 落点被占用时提前报错，让模型改为 update 提议而不是留一个必然冲突的 pending。
      const exists = await fs
        .access(resolved.absolute)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        throw new Error(`目标文件已存在，请改用 update 提议：${draft.targetPath}`);
      }
    }

    const proposal: MemoryPendingProposal = {
      id: `p-${Date.now()}-${randomUUID().slice(0, 8)}`,
      proposalType: draft.proposalType,
      title: draft.title,
      reason: draft.reason,
      targetPath: draft.targetPath.split(path.sep).join('/'),
      ...(contentHash ? { contentHash } : {}),
      ...(draft.relatedTo?.length ? { relatedTo: draft.relatedTo } : {}),
      source: draft.source,
      createdAt: new Date().toISOString(),
      content: draft.content ?? ''
    };

    const pendingDir = resolveWorkspaceMemoryPaths(resolved.cwd).pendingDir;
    await fs.mkdir(pendingDir, { recursive: true });
    await fs.writeFile(path.join(pendingDir, `${proposal.id}.md`), renderProposalFile(proposal), 'utf8');

    this.emitChange();
    return proposal;
  }

  /** 列出待处理提议；坏文件跳过并入诊断，不拖垮整表。 */
  async list(): Promise<MemoryPendingListResult> {
    const cwd = await this.options.resolveCwd();
    const pendingDir = resolveWorkspaceMemoryPaths(cwd).pendingDir;

    let entries: string[];

    try {
      entries = (await fs.readdir(pendingDir)).filter(name => name.endsWith('.md'));
    } catch {
      return { proposals: [], diagnostics: [] };
    }

    const proposals: MemoryPendingProposal[] = [];
    const diagnostics: MemoryPendingDiagnostic[] = [];

    for (const name of entries.toSorted()) {
      const filePath = path.join(pendingDir, name);

      try {
        proposals.push(parseProposalFile(await fs.readFile(filePath, 'utf8'), this.options.parseFrontmatter));
      } catch (error) {
        diagnostics.push({ filePath, message: error instanceof Error ? error.message : String(error) });
      }
    }

    return { proposals, diagnostics };
  }

  /** 接受或拒绝提议；终态提议移入 pending/archived/ 留痕（AgentRun 可溯）。 */
  async resolve(id: string, action: MemoryPendingAction): Promise<MemoryPendingResolveResult> {
    const cwd = await this.options.resolveCwd();
    const pendingDir = resolveWorkspaceMemoryPaths(cwd).pendingDir;
    const filePath = path.join(pendingDir, `${id}.md`);

    let proposal: MemoryPendingProposal;

    try {
      proposal = parseProposalFile(await fs.readFile(filePath, 'utf8'), this.options.parseFrontmatter);
    } catch {
      return { id, status: 'missing', message: '提议不存在或已被处理' };
    }

    if (action === 'reject') {
      await this.archiveProposal(pendingDir, filePath, 'rejected');
      this.emitChange();
      return { id, status: 'rejected' };
    }

    const applied = await this.applyProposal(proposal);

    if (applied.status === 'conflict') {
      return { id, status: 'conflict', ...(applied.message ? { message: applied.message } : {}) };
    }

    await this.archiveProposal(pendingDir, filePath, 'accepted');
    this.emitChange();
    return { id, status: 'applied' };
  }

  private async applyProposal(
    proposal: MemoryPendingProposal
  ): Promise<{ status: 'applied' | 'conflict'; message?: string }> {
    const resolved = await this.resolveTargetPath(proposal.targetPath);

    if (!resolved) {
      return { status: 'conflict', message: `目标路径不合法：${proposal.targetPath}` };
    }

    if (proposal.proposalType === 'create') {
      const exists = await fs
        .access(resolved.absolute)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        return { status: 'conflict', message: '落点已被占用（作者已创建同名文件）' };
      }

      await fs.mkdir(path.dirname(resolved.absolute), { recursive: true });
      await fs.writeFile(resolved.absolute, ensureTrailingNewline(proposal.content), 'utf8');
      return { status: 'applied' };
    }

    let current: string;

    try {
      current = await fs.readFile(resolved.absolute, 'utf8');
    } catch {
      return { status: 'conflict', message: '目标文件已不存在（可能被移动或删除）' };
    }

    if (proposal.contentHash && hashContent(current) !== proposal.contentHash) {
      return { status: 'conflict', message: '目标文件已被修改，提议基于的版本已过期' };
    }

    if (proposal.proposalType === 'update') {
      await fs.writeFile(resolved.absolute, ensureTrailingNewline(proposal.content), 'utf8');
      return { status: 'applied' };
    }

    await fs.writeFile(resolved.absolute, setFrontmatterStatusArchived(current), 'utf8');
    return { status: 'applied' };
  }

  private async archiveProposal(pendingDir: string, filePath: string, resolution: string): Promise<void> {
    const archivedDir = path.join(pendingDir, 'archived');
    await fs.mkdir(archivedDir, { recursive: true });

    const original = await fs.readFile(filePath, 'utf8');
    const stamped = `${original.trimEnd()}\n\n<!-- resolution: ${resolution} at ${new Date().toISOString()} -->\n`;

    await fs.writeFile(path.join(archivedDir, path.basename(filePath)), stamped, 'utf8');
    await fs.rm(filePath, { force: true });
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // 单个监听器异常不影响其余通知。
      }
    }
  }
}

const proposalTypes: ReadonlySet<string> = new Set(['create', 'update', 'archive']);

/** 提议正文经 frontmatter 解析往返不保真尾部空白；应用写盘时统一补末尾换行。 */
function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`;
}

/** 提议文件序列化：受控字段集合，字符串值一律 JSON 转义保证 YAML 安全。 */
function renderProposalFile(proposal: MemoryPendingProposal): string {
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

function parseProposalFile(raw: string, parse: FrontmatterParser): MemoryPendingProposal {
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
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);

  if (!match) {
    return `---\nstatus: archived\n---\n\n${content}`;
  }

  const block = match[1];

  if (/^status\s*:/m.test(block)) {
    const nextBlock = block.replace(/^status\s*:.*$/m, 'status: archived');
    return content.replace(block, nextBlock);
  }

  return content.replace(block, `${block}\nstatus: archived`);
}
