import { randomUUID } from 'node:crypto';
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

import type { FrontmatterParser } from '../../../core/frontmatter/types';
import { resolveWorkspaceMemoryPaths } from '../../../core/memory-layout/paths';
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

  /** 新增提议：update/archive 会读取目标文件计算 contentHash；返回提议 id。 */
  async add(cwd: string, draft: MemoryProposalDraft): Promise<MemoryPendingProposal> {
    const resolved = await this.resolveTargetPath(cwd, draft.targetPath);

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

    const pendingDir = await resolveWithinCwd(resolved.cwd, resolveWorkspaceMemoryPaths(resolved.cwd).pendingDir);
    await fs.mkdir(pendingDir, { recursive: true });
    await createTextAtomically(path.join(pendingDir, `${proposal.id}.md`), renderProposalFile(proposal));

    this.emitChange();
    return proposal;
  }

  /** 列出待处理提议；坏文件跳过并入诊断，不拖垮整表。 */
  async list(cwd: string): Promise<MemoryPendingListResult> {
    const pendingDir = resolveWorkspaceMemoryPaths(path.resolve(cwd)).pendingDir;

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
  async resolve(cwd: string, id: string, action: MemoryPendingAction): Promise<MemoryPendingResolveResult> {
    if (!/^[\w-]+$/.test(id)) return { id, status: 'missing', message: '提议标识无效' };
    const workspaceCwd = path.resolve(cwd);
    const pendingDir = await resolveWithinCwd(workspaceCwd, resolveWorkspaceMemoryPaths(workspaceCwd).pendingDir);
    const filePath = path.join(pendingDir, `${id}.md`);
    return withFileWriteLock(filePath, async () => {
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

      const applied = await this.applyProposal(workspaceCwd, proposal);

      if (applied.status === 'conflict') {
        return { id, status: 'conflict', ...(applied.message ? { message: applied.message } : {}) };
      }

      await this.archiveProposal(pendingDir, filePath, 'accepted');
      this.emitChange();
      return { id, status: 'applied' };
    });
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

      if (proposal.contentHash && hashContent(current) !== proposal.contentHash) {
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

  private async archiveProposal(pendingDir: string, filePath: string, resolution: string): Promise<void> {
    const archivedDir = path.join(pendingDir, 'archived');
    await fs.mkdir(archivedDir, { recursive: true });

    const original = await fs.readFile(filePath, 'utf8');
    const stamped = `${original.trimEnd()}\n\n<!-- resolution: ${resolution} at ${new Date().toISOString()} -->\n`;

    await writeTextAtomically(path.join(archivedDir, path.basename(filePath)), stamped);
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
