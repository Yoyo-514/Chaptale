import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type { CompleteSettlementArgs, ResolveSettlementArgs } from '@chaptale/ipc-contract';
import {
  SettlementBatchValidator,
  extractTaskOutput,
  type SettlementBatch,
  type SettlementDetails,
  type SettlementItem,
  type SettlementList
} from '@chaptale/shared';
import { patchDocumentFields } from '@chaptale/shared/document-frontmatter';

import { createArtifact, resolveArtifactPath } from '../../core/workspace/artifacts';
import { createTextAtomically, writeTextAtomically } from '../../infra/filesystem/atomic-text';
import { withFileWriteLock } from '../../infra/filesystem/write-lock';
import { readDocumentSnapshot } from '../workspace/read-document';
import type { WorkspaceService } from '../workspace/service';
import { assertItemTarget, authorPath, batchPath, chapterKey, hash, optionalSnapshot } from './files';
import { acceptanceContent, buildSettlementItems } from './proposals';
import { rebuildRecent } from './summaries';

export class SettlementStore {
  constructor(private readonly workspace: WorkspaceService) {}

  private async assertWorkspace(rootPath: string) {
    if ((await this.workspace.getState()).rootPath !== rootPath) throw new Error('作品已经切换');
  }
  async create(rootPath: string, batch: SettlementBatch) {
    await this.assertWorkspace(rootPath);
    this.validate(batch);
    await createArtifact(rootPath, batchPath(batch.id), JSON.stringify(batch));
  }
  private validate(batch: SettlementBatch) {
    if (!SettlementBatchValidator.Check(batch)) throw new Error('结算批次校验失败');
    if (chapterKey(batch.chapterPath, batch.chapterSourceId) !== batch.chapterKey) throw new Error('章节标识损坏');
    if (new Set(batch.items.map(item => item.id)).size !== batch.items.length) throw new Error('提议标识重复');
    if (new Set(batch.items.map(item => item.targetPath)).size !== batch.items.length) throw new Error('提议目标重复');
    for (const item of batch.items) assertItemTarget(batch, item);
    if (batch.completing) {
      if (
        batch.completing.length !== batch.scenes.length ||
        new Set(batch.completing.map(change => change.sourcePath)).size !== batch.scenes.length
      )
        throw new Error('结算场景意图不完整');
      for (const change of batch.completing) {
        if (
          !batch.scenes.some(
            scene => scene.sourcePath === change.sourcePath && scene.contentHash === change.beforeHash
          ) ||
          hash(change.beforeContent) !== change.beforeHash ||
          hash(change.content) !== change.afterHash ||
          patchDocumentFields(change.beforeContent, { settled: true }) !== change.content
        )
          throw new Error('结算场景意图损坏');
      }
    }
  }
  async read(rootPath: string, id: string): Promise<SettlementBatch> {
    await this.assertWorkspace(rootPath);
    await resolveArtifactPath(rootPath, batchPath(id));
    const document = await readDocumentSnapshot({ rootPath, relativePath: batchPath(id), maxBytes: 32 * 1024 * 1024 });
    const value: unknown = JSON.parse(document.content);
    if (!SettlementBatchValidator.Check(value) || value.id !== id) throw new Error('结算记录损坏');
    this.validate(value);
    if (value.outputHash) {
      if (!value.runId || value.outputRef !== `.chaptale/runs/outputs/${value.runId}.json`)
        throw new Error('结算输出引用无效');
      await resolveArtifactPath(rootPath, value.outputRef);
      const output = await readDocumentSnapshot({ rootPath, relativePath: value.outputRef, maxBytes: 8 * 1024 * 1024 });
      if (output.contentHash !== value.outputHash) throw new Error('结算原始输出已被修改');
    }
    return value;
  }
  private async save(rootPath: string, batch: SettlementBatch) {
    await this.assertWorkspace(rootPath);
    batch.revision += 1;
    batch.updatedAt = new Date().toISOString();
    this.validate(batch);
    const content = JSON.stringify(batch);
    if (Buffer.byteLength(content) > 32 * 1024 * 1024) throw new Error('结算批次超过保存上限');
    await writeTextAtomically(await resolveArtifactPath(rootPath, batchPath(batch.id)), content);
  }
  async list(rootPath: string): Promise<SettlementList> {
    await this.assertWorkspace(rootPath);
    let names: string[];
    try {
      names = await readdir(await resolveArtifactPath(rootPath, '.chaptale/memory/pending/batches'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { batches: [], diagnostics: [] };
      throw error;
    }
    const result: SettlementList = { batches: [], diagnostics: [] };
    for (const name of names.filter(value => /^[a-zA-Z0-9-]+\.json$/.test(value))) {
      try {
        const batch = await this.read(rootPath, name.slice(0, -5));
        result.batches.push({
          id: batch.id,
          revision: batch.revision,
          status: batch.status,
          chapterPath: batch.chapterPath,
          chapterTitle: batch.chapterTitle,
          chapterHash: batch.chapterHash,
          ...(batch.chapterSourceId ? { chapterSourceId: batch.chapterSourceId } : {}),
          createdAt: batch.createdAt,
          updatedAt: batch.updatedAt,
          ...(batch.error ? { error: batch.error } : {}),
          pending: batch.items.filter(item => item.status === 'pending').length,
          targets: batch.items.filter(item => item.status === 'pending').map(item => item.targetPath)
        });
      } catch (error) {
        result.diagnostics.push(`${name}: ${String(error)}`);
      }
    }
    result.batches = result.batches.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
    return result;
  }
  async details(rootPath: string, id: string): Promise<SettlementDetails> {
    const batch = await this.read(rootPath, id);
    const chapter = await optionalSnapshot(rootPath, batch.chapterPath);
    const conflicts: string[] = [];
    for (const item of batch.items.filter(value => value.status === 'pending')) {
      const current = await optionalSnapshot(rootPath, item.targetPath);
      if (
        current?.contentHash !== item.baseline?.contentHash &&
        (!item.applying || current?.contentHash !== item.applying.contentHash)
      )
        conflicts.push(item.targetPath);
    }
    return { batch, stale: chapter?.contentHash !== batch.chapterHash, conflicts };
  }
  async finish(rootPath: string, id: string, result: { output: unknown; runId: string; outputRef: string }) {
    const filename = await resolveArtifactPath(rootPath, batchPath(id));
    await withFileWriteLock(filename, async () => {
      const batch = await this.read(rootPath, id);
      if (batch.status !== 'generating') throw new Error('结算已经结束');
      if (result.outputRef !== `.chaptale/runs/outputs/${result.runId}.json`) throw new Error('结算输出引用无效');
      await resolveArtifactPath(rootPath, result.outputRef);
      const output = await readDocumentSnapshot({
        rootPath,
        relativePath: result.outputRef,
        maxBytes: 8 * 1024 * 1024
      });
      const stored: unknown = JSON.parse(output.content);
      if (
        !stored ||
        typeof stored !== 'object' ||
        !('runId' in stored) ||
        stored.runId !== result.runId ||
        !('rawText' in stored) ||
        typeof stored.rawText !== 'string'
      )
        throw new Error('结算输出留档损坏');
      const extracted = extractTaskOutput(stored.rawText);
      if (!extracted.ok || !isDeepStrictEqual(extracted.value, result.output)) throw new Error('结算结果与留档不一致');
      if ((await optionalSnapshot(rootPath, batch.chapterPath))?.contentHash !== batch.chapterHash)
        throw new Error('正文已变化，请重新结算');
      batch.items = await buildSettlementItems(rootPath, batch, result.output);
      batch.status = 'ready';
      batch.runId = result.runId;
      batch.outputRef = result.outputRef;
      batch.outputHash = output.contentHash;
      await this.save(rootPath, batch);
    });
  }
  async stop(
    rootPath: string,
    id: string,
    status: 'failed' | 'cancelled',
    error?: string,
    runId?: string,
    outputRef?: string
  ) {
    await withFileWriteLock(await resolveArtifactPath(rootPath, batchPath(id)), async () => {
      const batch = await this.read(rootPath, id);
      if (batch.status !== 'generating') return;
      batch.status = status;
      if (error) batch.error = error;
      if (runId) batch.runId = runId;
      if (outputRef) batch.outputRef = outputRef;
      await this.save(rootPath, batch);
    });
  }
  private async apply(rootPath: string, batch: SettlementBatch, item: SettlementItem) {
    assertItemTarget(batch, item);
    const intent = item.applying;
    if (
      !intent ||
      hash(intent.content) !== intent.contentHash ||
      acceptanceContent(batch, item, item.editedContent, intent.at) !== intent.content
    )
      throw new Error('接受意图损坏');
    const filename =
      item.category === 'summary'
        ? await resolveArtifactPath(rootPath, item.targetPath)
        : await authorPath(rootPath, item.targetPath);
    await withFileWriteLock(filename, async () => {
      await this.assertWorkspace(rootPath);
      if (item.category === 'summary') await resolveArtifactPath(rootPath, item.targetPath);
      else await authorPath(rootPath, item.targetPath);
      const current = await optionalSnapshot(rootPath, item.targetPath);
      if (current?.contentHash === intent.contentHash) return;
      if ((await optionalSnapshot(rootPath, batch.chapterPath))?.contentHash !== batch.chapterHash)
        throw new Error('正文已变化，请重新结算');
      if (current?.contentHash !== item.baseline?.contentHash) throw new Error('资产已变化，提议未覆盖新内容');
      await mkdir(path.dirname(filename), { recursive: true });
      if (item.category === 'summary') await resolveArtifactPath(rootPath, item.targetPath);
      else await authorPath(rootPath, item.targetPath);
      if (current) await writeTextAtomically(filename, intent.content);
      else await createTextAtomically(filename, intent.content);
      const saved = await optionalSnapshot(rootPath, item.targetPath);
      if (saved?.contentHash !== intent.contentHash) throw new Error('写入后目标再次变化，保留接受意图');
    });
  }
  async resolve(args: ResolveSettlementArgs) {
    await withFileWriteLock(await resolveArtifactPath(args.rootPath, batchPath(args.batchId)), async () => {
      const batch = await this.read(args.rootPath, args.batchId);
      if (batch.revision !== args.revision) throw new Error('结算状态已变化，请刷新');
      if (batch.status !== 'ready' || batch.completing) throw new Error('结算当前不可处理');
      const item = batch.items.find(value => value.id === args.itemId);
      if (!item || item.status !== 'pending') throw new Error('提议已经处理或不存在');
      if (args.action === 'reject') {
        if (
          item.applying &&
          (await optionalSnapshot(args.rootPath, item.targetPath))?.contentHash === item.applying.contentHash
        )
          throw new Error('此前接受已写入，请重试接受以恢复状态');
        delete item.applying;
        item.status = 'rejected';
        item.decidedAt = new Date().toISOString();
        await this.save(args.rootPath, batch);
        return;
      }
      if (!item.applying) {
        if ((await optionalSnapshot(args.rootPath, batch.chapterPath))?.contentHash !== batch.chapterHash)
          throw new Error('正文已变化，请重新结算');
        if ((await optionalSnapshot(args.rootPath, item.targetPath))?.contentHash !== item.baseline?.contentHash)
          throw new Error('资产已变化，提议未覆盖新内容');
        const at = new Date().toISOString();
        const content = acceptanceContent(batch, item, args.editedContent, at);
        item.applying = { content, contentHash: hash(content), at };
        if (args.editedContent !== undefined) item.editedContent = args.editedContent;
        await this.save(args.rootPath, batch);
      } else if (args.editedContent !== undefined && args.editedContent !== item.editedContent) {
        throw new Error('正在恢复此前接受，不能同时修改提议');
      }
      await this.apply(args.rootPath, batch, item);
      item.status = 'accepted';
      item.acceptedHash = item.applying.contentHash;
      item.decidedAt = item.applying.at;
      delete item.applying;
      await this.save(args.rootPath, batch);
    });
    const batch = await this.read(args.rootPath, args.batchId);
    if (batch.items.some(item => item.category === 'summary' && item.status === 'accepted'))
      await rebuildRecent(args.rootPath);
    return this.details(args.rootPath, args.batchId);
  }
  async complete(args: CompleteSettlementArgs) {
    await withFileWriteLock(await resolveArtifactPath(args.rootPath, batchPath(args.batchId)), async () => {
      const batch = await this.read(args.rootPath, args.batchId);
      if (batch.status === 'completed') return;
      if (batch.revision !== args.revision) throw new Error('结算状态已变化，请刷新');
      if (batch.status !== 'ready' || batch.items.some(item => item.status === 'pending'))
        throw new Error('请先处理所有提议');
      if ((await optionalSnapshot(args.rootPath, batch.chapterPath))?.contentHash !== batch.chapterHash)
        throw new Error('正文已变化，不能标记已结算');
      if (!batch.completing) {
        const changes: NonNullable<SettlementBatch['completing']> = [];
        for (const scene of batch.scenes) {
          await authorPath(args.rootPath, scene.sourcePath);
          const current = await optionalSnapshot(args.rootPath, scene.sourcePath);
          if (!current || current.contentHash !== scene.contentHash) throw new Error('场景卡已变化，请重新结算');
          const content = patchDocumentFields(current.content, { settled: true });
          changes.push({
            sourcePath: scene.sourcePath,
            beforeContent: current.content,
            beforeHash: current.contentHash,
            afterHash: hash(content),
            content
          });
        }
        batch.completing = changes;
        await this.save(args.rootPath, batch);
      }
      for (const change of batch.completing) {
        if (
          !batch.scenes.some(scene => scene.sourcePath === change.sourcePath && scene.contentHash === change.beforeHash)
        )
          throw new Error('结算场景引用损坏');
        await authorPath(args.rootPath, change.sourcePath);
        const current = await optionalSnapshot(args.rootPath, change.sourcePath);
        if (current?.contentHash === change.afterHash) continue;
        if (!current || current.contentHash !== change.beforeHash || hash(change.content) !== change.afterHash)
          throw new Error('场景卡已变化，完成操作可重试');
        const result = await this.workspace.writeDocument({
          rootPath: args.rootPath,
          relativePath: change.sourcePath,
          expectedHash: current.contentHash,
          content: change.content
        });
        if (!result.ok) throw new Error(result.message);
      }
      await rebuildRecent(args.rootPath);
      batch.status = 'completed';
      batch.completedAt = new Date().toISOString();
      delete batch.completing;
      await this.save(args.rootPath, batch);
    });
    return this.details(args.rootPath, args.batchId);
  }
}
