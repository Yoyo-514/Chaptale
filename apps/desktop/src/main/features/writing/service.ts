import {
  DraftRequestValidator,
  RewriteRequestValidator,
  type ApplyCandidateArgs,
  type CandidateIdArgs,
  type DraftRequest,
  type RewriteSelection,
  type RewriteRequest,
  type FinalizeChapterArgs,
  type RestoreVersionArgs
} from '@chaptale/ipc-contract';
import { applyDocumentEdits, applyRewriteEdits, normalizeDocumentText, type Candidate } from '@chaptale/shared';
import { patchDocumentFields } from '@chaptale/shared/document-frontmatter';

import type { ModelService } from '../../core/models/service';
import { resolveArtifactPath } from '../../core/workspace/artifacts';
import { withFileWriteLock } from '../../infra/filesystem/write-lock';
import type { LibraryService } from '../library/service';
import type { PersonaRegistry } from '../personas/registry';
import type { TaskRunnerPort } from '../tasks/runner-port';
import type { WorkspaceService } from '../workspace/service';
import { assertWritingTarget, CandidateStore } from './candidates';
import { prepareRewriteInput, type ReviewReader } from './rewrite';
import { VersionStore } from './versions';

export class WritingService {
  private readonly running = new Map<string, AbortController>();
  readonly candidates: CandidateStore;
  constructor(
    private readonly options: {
      workspace: WorkspaceService;
      library: LibraryService;
      personas: PersonaRegistry;
      models: ModelService;
      tasks: TaskRunnerPort;
      readReview?: ReviewReader;
      versions?: VersionStore;
    }
  ) {
    this.candidates = new CandidateStore(
      options.workspace,
      options.versions ?? new VersionStore(async rootPath => (await options.library.listAssets(rootPath)).assets)
    );
  }
  private key(args: CandidateIdArgs) {
    return `${args.rootPath}\0${args.candidateId}`;
  }
  async generate(args: DraftRequest) {
    if (!DraftRequestValidator.Check([args])) throw new Error('候选请求不合法');
    await this.options.library.assertWorkspace(args.rootPath);
    assertWritingTarget(args.targetPath);
    const key = this.key(args);
    if (this.running.has(key)) throw new Error('候选正在生成');
    const controller = new AbortController();
    this.running.set(key, controller);
    let created = false;
    try {
      const pack = await this.options.library.readPack(args.rootPath, args.packId);
      const freshness = await this.options.library.checkPack(args.rootPath, args.packId);
      if (freshness.stale && !args.allowStalePack) throw new Error('参考来源已更新，请重组或明确使用旧快照');
      const read = await this.options.workspace.readDocument({
        rootPath: args.rootPath,
        relativePath: args.targetPath,
        maxBytes: 8 * 1024 * 1024
      });
      if (!read.ok) throw new Error(read.message);
      const document = read.document;
      if (document.contentHash !== args.expectedHash) throw new Error('目标正文已变化，请重新确认');
      const text = normalizeDocumentText(document.content);
      const bodyStart =
        document.head.status === 'ok' ? text.length - normalizeDocumentText(document.head.body).length : 0;
      if (args.range.from < bodyStart || args.range.to < args.range.from || args.range.to > text.length)
        throw new Error('生成范围无效，不能修改 frontmatter');
      applyDocumentEdits(document.content, [{ ...args.range, insert: '' }]);
      const model = (await this.options.models.listModels()).models.find(
        value => value.provider === args.model.provider && value.id === args.model.modelId
      );
      if (!model?.authConfigured) throw new Error('所选模型不可用，请检查配置');
      const persona = await this.options.personas.get(args.rootPath, 'draft');
      if (!persona || persona.output !== 'draft-markdown' || persona.execution !== 'task')
        throw new Error('draft persona 不可用');
      const now = new Date().toISOString();
      const candidate: Candidate = {
        id: args.candidateId,
        revision: 1,
        status: 'preparing',
        targetPath: args.targetPath,
        baselineHash: document.contentHash,
        baselineContent: document.content,
        proposedContent: document.content,
        range: args.range,
        goal: pack.goal,
        packId: pack.id,
        personaId: persona.id,
        model: args.model,
        usedStalePack: freshness.stale,
        createdAt: now,
        updatedAt: now,
        acceptances: [],
        ...(args.parentId ? { parentId: args.parentId } : {})
      };
      await this.options.library.assertWorkspace(args.rootPath);
      await this.candidates.create(args.rootPath, candidate);
      created = true;
      if (controller.signal.aborted)
        return await this.candidates.setStatus(args.rootPath, args.candidateId, 'cancelled');
      await this.candidates.setStatus(args.rootPath, args.candidateId, 'generating');
      const result = await this.options.tasks.run({
        cwd: args.rootPath,
        persona,
        model: args.model,
        frozenContext: true,
        strictInputBudget: true,
        brief: `创作指定范围的候选片段。目标：${pack.goal}\n目标文件：${args.targetPath}\nUTF-16/LF 范围：[${args.range.from}, ${args.range.to})；范围外仅供衔接，不要输出。`,
        text,
        contextPrompt: pack.prompt,
        files: [args.targetPath],
        packId: pack.id,
        memoryRefs: pack.sections.map(section => `${section.sourcePath}#${section.sourceHash}`),
        trigger: 'ui-action',
        signal: controller.signal
      });
      if (result.status === 'success') {
        return await this.candidates.finish(
          args.rootPath,
          args.candidateId,
          String(result.output),
          result.runId,
          result.outputRef
        );
      }
      return await this.candidates.setStatus(
        args.rootPath,
        args.candidateId,
        result.status === 'cancelled' ? 'cancelled' : 'failed',
        result.status === 'failed' ? result.errors.join('\n') : undefined,
        { runId: result.runId, ...(result.status === 'failed' ? { outputRef: result.outputRef } : {}) }
      );
    } catch (error) {
      if (created)
        return await this.candidates.setStatus(
          args.rootPath,
          args.candidateId,
          'failed',
          error instanceof Error ? error.message : String(error)
        );
      throw error;
    } finally {
      this.running.delete(key);
    }
  }
  async cancel(args: CandidateIdArgs) {
    await this.options.library.assertWorkspace(args.rootPath);
    this.running.get(this.key(args))?.abort();
  }
  private async rewriteInput(args: RewriteSelection) {
    await this.options.library.assertWorkspace(args.rootPath);
    if (!this.options.readReview) throw new Error('审查读取服务不可用');
    return prepareRewriteInput(args, {
      readReview: this.options.readReview,
      workspace: this.options.workspace,
      candidates: this.candidates
    });
  }
  async prepareRewrite(args: RewriteSelection) {
    return (await this.rewriteInput(args)).plan;
  }
  async rewrite(args: RewriteRequest) {
    if (!RewriteRequestValidator.Check([args])) throw new Error('修订请求不合法');
    const key = this.key(args);
    if (this.running.has(key)) throw new Error('候选正在生成');
    const controller = new AbortController();
    this.running.set(key, controller);
    let created = false;
    let outputRun: { runId: string; outputRef: string } | undefined;
    try {
      const { plan, baselineContent, sourceContent } = await this.rewriteInput({
        rootPath: args.rootPath,
        reviewId: args.reviewId,
        issueIndexes: args.issueIndexes
      });
      if (
        plan.expectedHash !== args.expectedHash ||
        plan.sourceHash !== args.sourceHash ||
        plan.outputHash !== args.outputHash
      )
        throw new Error('修订输入已变化，请重新确认');
      const pack = await this.options.library.readPack(args.rootPath, args.packId);
      if (plan.packId && plan.packId !== pack.id) throw new Error('修订必须使用审查时的参考快照');
      const freshness = await this.options.library.checkPack(args.rootPath, pack.id);
      if (freshness.stale && !args.allowStalePack) throw new Error('参考已更新，请重审或确认使用旧快照');
      const model = (await this.options.models.listModels()).models.find(
        value => value.provider === args.model.provider && value.id === args.model.modelId
      );
      if (!model?.authConfigured) throw new Error('所选模型不可用');
      const persona = await this.options.personas.get(args.rootPath, 'rewriter');
      if (!persona || persona.execution !== 'task' || persona.output !== 'rewrite-edits')
        throw new Error('rewriter persona 不可用');
      const now = new Date().toISOString();
      await this.options.library.assertWorkspace(args.rootPath);
      await this.candidates.create(args.rootPath, {
        id: args.candidateId,
        revision: 1,
        status: 'preparing',
        targetPath: plan.targetPath,
        baselineHash: plan.expectedHash,
        baselineContent,
        proposedContent: baselineContent,
        range: { from: plan.spans[0]!.from, to: plan.spans.at(-1)!.to },
        goal: '修复选中的审查问题',
        packId: pack.id,
        personaId: persona.id,
        model: args.model,
        usedStalePack: freshness.stale,
        ...(plan.parentId ? { parentId: plan.parentId } : {}),
        reviewRef: {
          requestId: args.reviewId,
          outputHash: plan.outputHash,
          issueIndexes: [...new Set(args.issueIndexes)].toSorted((a, b) => a - b),
          sourceHash: plan.sourceHash
        },
        createdAt: now,
        updatedAt: now,
        acceptances: []
      });
      created = true;
      if (controller.signal.aborted)
        return await this.candidates.setStatus(args.rootPath, args.candidateId, 'cancelled');
      await this.candidates.setStatus(args.rootPath, args.candidateId, 'generating');
      const result = await this.options.tasks.run({
        cwd: args.rootPath,
        persona,
        model: args.model,
        frozenContext: true,
        strictInputBudget: true,
        brief: `只修复选中问题。允许修改行之外仅供衔接。输出逐条精确替换。\n${JSON.stringify({
          issues: plan.issues,
          allowedLines: plan.spans
        })}`,
        text: plan.sourceText,
        contextPrompt: pack.prompt,
        files: [plan.targetPath, `.chaptale/reviews/jobs/${args.reviewId}.json`],
        packId: pack.id,
        memoryRefs: pack.sections.map(section => `${section.sourcePath}#${section.sourceHash}`),
        trigger: 'ui-action',
        signal: controller.signal
      });
      if (result.status === 'success') {
        outputRun = { runId: result.runId, outputRef: result.outputRef };
        const content = applyRewriteEdits(sourceContent, result.output, plan.spans);
        return await this.candidates.finishRevision(
          args.rootPath,
          args.candidateId,
          content,
          result.runId,
          result.outputRef
        );
      }
      return await this.candidates.setStatus(
        args.rootPath,
        args.candidateId,
        result.status === 'cancelled' ? 'cancelled' : 'failed',
        result.status === 'failed' ? result.errors.join('\n') : undefined,
        { runId: result.runId, ...(result.status === 'failed' ? { outputRef: result.outputRef } : {}) }
      );
    } catch (error) {
      if (!created) throw error;
      return this.candidates.setStatus(
        args.rootPath,
        args.candidateId,
        'failed',
        error instanceof Error ? error.message : String(error),
        outputRun
      );
    } finally {
      this.running.delete(key);
    }
  }
  async listCandidates(args: { rootPath: string }) {
    await this.options.library.assertWorkspace(args.rootPath);
    const list = await this.candidates.list(args.rootPath);
    for (const item of list.candidates) {
      if (
        ['preparing', 'generating'].includes(item.status) &&
        !this.running.has(this.key({ ...args, candidateId: item.id }))
      ) {
        await this.candidates.setStatus(args.rootPath, item.id, 'failed', '上次运行已中断，原正文未修改');
      }
    }
    return this.candidates.list(args.rootPath);
  }
  async readCandidate(args: CandidateIdArgs) {
    await this.options.library.assertWorkspace(args.rootPath);
    return this.candidates.read(args.rootPath, args.candidateId);
  }
  async discard(args: CandidateIdArgs) {
    await this.options.library.assertWorkspace(args.rootPath);
    return this.candidates.setStatus(args.rootPath, args.candidateId, 'discarded');
  }
  async apply(args: ApplyCandidateArgs) {
    await this.options.library.assertWorkspace(args.rootPath);
    return this.candidates.apply(args);
  }
  async listVersions(args: { rootPath: string; targetPath: string }) {
    await this.options.library.assertWorkspace(args.rootPath);
    return this.candidates.versions.list(args.rootPath, args.targetPath);
  }
  async readVersion(args: { rootPath: string; targetPath: string; snapshotId: string }) {
    await this.options.library.assertWorkspace(args.rootPath);
    return this.candidates.versions.read(args.rootPath, args.targetPath, args.snapshotId);
  }
  private async savedTarget(args: { rootPath: string; targetPath: string; expectedHash: string }) {
    await this.options.library.assertWorkspace(args.rootPath);
    assertWritingTarget(args.targetPath);
    const result = await this.options.workspace.readDocument({
      rootPath: args.rootPath,
      relativePath: args.targetPath,
      maxBytes: 8 * 1024 * 1024
    });
    if (!result.ok) throw new Error(result.message);
    if (result.document.contentHash !== args.expectedHash) throw new Error('文档已变化，请重新比较');
    return result.document;
  }
  async finalizeChapter(args: FinalizeChapterArgs) {
    const document = await this.savedTarget(args);
    if (document.head.status === 'invalid') throw new Error('请先修正章节元数据');
    const head = document.head.status === 'ok' ? document.head.frontmatter : {};
    const layout = await this.options.workspace.getLayout(args.rootPath);
    if (!layout.ok) throw new Error(layout.message);
    if (
      head.kind !== 'chapter' &&
      (head.kind !== undefined || !args.targetPath.startsWith(`${layout.layout.roles.manuscript.relativePath}/`))
    )
      throw new Error('只能定稿章节');
    if (!document.head.body.trim()) throw new Error('空章节不能定稿');
    if (
      head.status === 'final' &&
      (await this.candidates.versions.list(args.rootPath, args.targetPath)).some(
        snapshot => snapshot.reason === 'final' && snapshot.contentHash === document.contentHash
      )
    )
      return document;
    if (head.status === 'final') {
      await this.candidates.versions.save(document, 'final');
      return document;
    }
    await this.candidates.versions.save(document, 'before-final');
    const content = patchDocumentFields(document.content, { status: 'final' });
    await this.candidates.versions.preserveFinalization(
      { rootPath: args.rootPath, relativePath: args.targetPath, content },
      document
    );
    const result = await this.options.workspace.writeDocument({
      rootPath: args.rootPath,
      relativePath: args.targetPath,
      expectedHash: args.expectedHash,
      content
    });
    if (!result.ok) throw new Error(result.message);
    return result.document;
  }
  async restoreVersion(args: RestoreVersionArgs) {
    const lock = await resolveArtifactPath(args.rootPath, '.chaptale/revisions/restore');
    return withFileWriteLock(lock, async () => {
      const document = await this.savedTarget(args);
      const selected = await this.candidates.versions.read(args.rootPath, args.targetPath, args.snapshotId);
      if (document.contentHash === selected.snapshot.contentHash) return document;
      await this.candidates.versions.save(document, 'before-rollback', undefined, args.snapshotId);
      const result = await this.options.workspace.writeDocument({
        rootPath: args.rootPath,
        relativePath: args.targetPath,
        expectedHash: args.expectedHash,
        content: selected.content
      });
      if (!result.ok) throw new Error(result.message);
      try {
        await this.candidates.versions.save(result.document, 'rollback', undefined, args.snapshotId);
      } catch (error) {
        throw new Error('正文已恢复，但回滚版本登记失败；回滚前快照与目标关联已保留，请刷新检查', { cause: error });
      }
      return result.document;
    });
  }
}
