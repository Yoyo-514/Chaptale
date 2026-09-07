import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { WorkspaceRelativePathValidator } from '@chaptale/shared';
import type {
  MemoryPendingAction,
  MemoryPendingDetails,
  MemoryPendingDiagnostic,
  MemoryPendingListResult,
  MemoryPendingProposal,
  MemoryPendingResolveResult,
  MemoryProposalType
} from '@chaptale/shared';
import { parseDocumentFrontmatter } from '@chaptale/shared/document-frontmatter';

import type { FrontmatterParser } from '../../../core/frontmatter/types';
import { createArtifact, resolveArtifactPath } from '../../../core/workspace/artifacts';
import { WorkspaceLayoutService } from '../../../core/workspace/layout';
import { createTextAtomically, writeTextAtomically } from '../../../infra/filesystem/atomic-text';
import { resolveWithinCwd } from '../../../infra/filesystem/path-guard';
import { withFileWriteLock } from '../../../infra/filesystem/write-lock';
import {
  ensureTrailingNewline,
  hashContent,
  parseProposalFile,
  renderProposalFile,
  setFrontmatterStatusArchived
} from './proposal-file';

export type MemoryPendingStoreOptions = {
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
  private async resolveTargetPath(cwd: string, targetPath: string): Promise<{ cwd: string; absolute: string } | null> {
    if (
      !WorkspaceRelativePathValidator.Check(targetPath) ||
      !/\.(md|markdown)$/i.test(targetPath) ||
      targetPath.split('/').some(part => part.startsWith('.'))
    )
      return null;
    const workspaceCwd = path.resolve(cwd);
    const absolute = path.resolve(workspaceCwd, targetPath);

    if (absolute === workspaceCwd || !absolute.startsWith(workspaceCwd + path.sep)) {
      return null;
    }

    const relative = path.relative(workspaceCwd, absolute);
    if (relative.split(path.sep)[0]?.toLowerCase() === '.chaptale') {
      return null;
    }
    try {
      await resolveWithinCwd(workspaceCwd, targetPath);
      let probe = workspaceCwd;
      // 根目录可为链接，提议目标内部不跟随链接，避免指回运行时目录。
      for (const part of relative.split(path.sep)) {
        probe = path.join(probe, part);
        try {
          if ((await fs.lstat(probe)).isSymbolicLink()) return null;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
          break;
        }
      }
    } catch {
      return null;
    }
    return { cwd: workspaceCwd, absolute };
  }

  private async proposalConflict(cwd: string, proposal: MemoryProposalDraft, current?: string) {
    const layout = await new WorkspaceLayoutService().read(cwd);
    const target = proposal.targetPath.toLowerCase();
    const manuscript = layout.roles.manuscript.relativePath.toLowerCase();
    const before = current === undefined ? undefined : parseDocumentFrontmatter(current);
    const after = parseDocumentFrontmatter(proposal.content ?? '');
    if (
      target === manuscript ||
      target.startsWith(`${manuscript}/`) ||
      (before?.status === 'ok' && before.frontmatter.kind === 'chapter') ||
      (after.status === 'ok' && after.frontmatter.kind === 'chapter')
    )
      return '正文修改必须通过候选稿确认，不能使用资产提议';
    if (before?.status === 'invalid' || after.status === 'invalid') return '请先修正资产或提议的元数据';
    if (
      proposal.proposalType !== 'archive' &&
      (!proposal.content?.trim() ||
        !proposal.content.isWellFormed() ||
        proposal.content.includes('\0') ||
        Buffer.byteLength(proposal.content) > 8 * 1024 * 1024)
    )
      return '提议内容为空、无效或超过 8 MiB';
    return undefined;
  }

  /** 新增提议：update/archive 会读取目标文件计算 contentHash；返回提议 id。 */
  async add(cwd: string, draft: MemoryProposalDraft): Promise<MemoryPendingProposal> {
    const resolved = await this.resolveTargetPath(cwd, draft.targetPath);

    if (!resolved) {
      throw new Error(`目标路径不合法（必须在作品内且不得指向 .chaptale）：${draft.targetPath}`);
    }

    let contentHash: string | undefined;
    let current: string | undefined;

    if (draft.proposalType === 'update' || draft.proposalType === 'archive') {
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
    const conflict = await this.proposalConflict(resolved.cwd, draft, current);
    if (conflict) throw new Error(conflict);

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

    await createArtifact(resolved.cwd, `.chaptale/memory/pending/${proposal.id}.md`, renderProposalFile(proposal));

    this.emitChange();
    return proposal;
  }

  /** 列出待处理提议；坏文件跳过并入诊断，不拖垮整表。 */
  async list(cwd: string): Promise<MemoryPendingListResult> {
    const pendingPath = '.chaptale/memory/pending';

    let entries: string[];

    try {
      entries = (await fs.readdir(await resolveArtifactPath(cwd, pendingPath))).filter(name => name.endsWith('.md'));
    } catch (error) {
      return {
        proposals: [],
        diagnostics:
          (error as NodeJS.ErrnoException).code === 'ENOENT' ? [] : [{ filePath: pendingPath, message: String(error) }]
      };
    }

    const proposals: MemoryPendingProposal[] = [];
    const diagnostics: MemoryPendingDiagnostic[] = [];

    for (const name of entries.toSorted()) {
      const filePath = `${pendingPath}/${name}`;

      try {
        const absolute = await resolveArtifactPath(cwd, filePath);
        if ((await fs.stat(absolute)).size > 8 * 1024 * 1024) throw new Error('提议过大');
        const proposal = parseProposalFile(await fs.readFile(absolute, 'utf8'), this.options.parseFrontmatter);
        if (`${proposal.id}.md` !== name) throw new Error('提议标识与文件名不符');
        proposals.push(proposal);
      } catch (error) {
        diagnostics.push({ filePath, message: error instanceof Error ? error.message : String(error) });
      }
    }

    return { proposals, diagnostics };
  }

  /** 接受或拒绝提议；终态提议移入 pending/archived/ 留痕（AgentRun 可溯）。 */
  async resolve(
    cwd: string,
    id: string,
    action: MemoryPendingAction,
    expectedProposalHash?: string
  ): Promise<MemoryPendingResolveResult> {
    if (!/^[\w-]+$/.test(id)) return { id, status: 'missing', message: '提议标识无效' };
    const workspaceCwd = path.resolve(cwd);
    const filePath = await resolveArtifactPath(workspaceCwd, `.chaptale/memory/pending/${id}.md`);
    return withFileWriteLock(filePath, async () => {
      await resolveArtifactPath(workspaceCwd, `.chaptale/memory/pending/${id}.md`);
      let proposal: MemoryPendingProposal;

      try {
        if ((await fs.stat(filePath)).size > 8 * 1024 * 1024) throw new Error('提议过大');
        const raw = await fs.readFile(filePath, 'utf8');
        if (expectedProposalHash && hashContent(raw) !== expectedProposalHash)
          return { id, status: 'conflict', message: '提议已变化，请重新查看差异' };
        proposal = parseProposalFile(raw, this.options.parseFrontmatter);
        if (proposal.id !== id) return { id, status: 'conflict', message: '提议标识与文件名不符' };
      } catch {
        return { id, status: 'missing', message: '提议不存在或已被处理' };
      }

      if (action === 'reject') {
        await this.archiveProposal(workspaceCwd, id, 'rejected');
        this.emitChange();
        return { id, status: 'rejected' };
      }

      const applied = await this.applyProposal(workspaceCwd, proposal);

      if (applied.status === 'conflict') {
        return { id, status: 'conflict', ...(applied.message ? { message: applied.message } : {}) };
      }

      await this.archiveProposal(workspaceCwd, id, 'accepted');
      this.emitChange();
      return { id, status: 'applied' };
    });
  }

  async inspect(cwd: string, id: string): Promise<MemoryPendingDetails> {
    if (!/^[\w-]+$/.test(id)) throw new Error('提议标识无效');
    const filePath = await resolveArtifactPath(cwd, `.chaptale/memory/pending/${id}.md`);
    if ((await fs.stat(filePath)).size > 8 * 1024 * 1024) throw new Error('提议过大');
    const raw = await fs.readFile(filePath, 'utf8');
    const proposal = parseProposalFile(raw, this.options.parseFrontmatter);
    if (proposal.id !== id) throw new Error('提议标识与文件名不符');
    const target = await this.resolveTargetPath(cwd, proposal.targetPath);
    if (!target) throw new Error('提议目标无效');
    let original = '';
    let exists = false;
    try {
      if ((await fs.stat(target.absolute)).size > 8 * 1024 * 1024) throw new Error('资产过大');
      original = await fs.readFile(target.absolute, 'utf8');
      exists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const conflict =
      (await this.proposalConflict(cwd, proposal, exists ? original : undefined)) ??
      (proposal.proposalType === 'create'
        ? exists
          ? '落点已被占用'
          : undefined
        : !exists
          ? '原文件已不存在'
          : !proposal.contentHash || hashContent(original) !== proposal.contentHash
            ? '资产已变化，请重新提出修改'
            : undefined);
    return {
      proposal,
      proposalHash: hashContent(raw),
      original,
      modified:
        proposal.proposalType === 'archive'
          ? setFrontmatterStatusArchived(original)
          : ensureTrailingNewline(proposal.content),
      ...(conflict ? { conflict } : {})
    };
  }

  private async applyProposal(
    cwd: string,
    proposal: MemoryPendingProposal
  ): Promise<{ status: 'applied' | 'conflict'; message?: string }> {
    const resolved = await this.resolveTargetPath(cwd, proposal.targetPath);

    if (!resolved) {
      return { status: 'conflict', message: `目标路径不合法：${proposal.targetPath}` };
    }
    return withFileWriteLock(resolved.absolute, async () => {
      if (!(await this.resolveTargetPath(cwd, proposal.targetPath))) {
        return { status: 'conflict', message: '目标路径已变化，未应用提议' };
      }
      if (proposal.proposalType === 'create') {
        const conflict = await this.proposalConflict(cwd, proposal);
        if (conflict) return { status: 'conflict', message: conflict };
        const exists = await fs
          .access(resolved.absolute)
          .then(() => true)
          .catch(() => false);

        if (exists) {
          return { status: 'conflict', message: '落点已被占用（作者已创建同名文件）' };
        }

        await fs.mkdir(path.dirname(resolved.absolute), { recursive: true });
        try {
          await createTextAtomically(resolved.absolute, ensureTrailingNewline(proposal.content));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST')
            return { status: 'conflict', message: '落点已被占用' };
          throw error;
        }
        return { status: 'applied' };
      }

      let current: string;

      try {
        current = await fs.readFile(resolved.absolute, 'utf8');
      } catch {
        return { status: 'conflict', message: '目标文件已不存在（可能被移动或删除）' };
      }

      const conflict = await this.proposalConflict(cwd, proposal, current);
      if (conflict) return { status: 'conflict', message: conflict };
      if (!proposal.contentHash || hashContent(current) !== proposal.contentHash) {
        return { status: 'conflict', message: '目标文件已被修改，提议基于的版本已过期' };
      }

      if (proposal.proposalType === 'update') {
        await writeTextAtomically(resolved.absolute, ensureTrailingNewline(proposal.content));
        return { status: 'applied' };
      }

      await writeTextAtomically(resolved.absolute, setFrontmatterStatusArchived(current));
      return { status: 'applied' };
    });
  }

  private async archiveProposal(cwd: string, id: string, resolution: string): Promise<void> {
    const filePath = await resolveArtifactPath(cwd, `.chaptale/memory/pending/${id}.md`);
    const original = await fs.readFile(filePath, 'utf8');
    const stamped = `${original.trimEnd()}\n\n<!-- resolution: ${resolution} at ${new Date().toISOString()} -->\n`;

    await createArtifact(cwd, `.chaptale/memory/pending/archived/${id}.md`, stamped);
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
