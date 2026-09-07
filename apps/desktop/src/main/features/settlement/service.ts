import type { PrepareSettlementArgs, SettlementIdArgs, StartSettlementArgs } from '@chaptale/ipc-contract';
import type { SettlementBatch, SettlementPlan } from '@chaptale/shared';

import { estimateTextTokens } from '../../core/context/token-counter';
import type { ModelService } from '../../core/models/service';
import { resolveArtifactPath } from '../../core/workspace/artifacts';
import type { LibraryService } from '../library/service';
import type { PersonaRegistry } from '../personas/registry';
import type { TaskRunnerPort } from '../tasks/runner-port';
import type { WorkspaceService } from '../workspace/service';
import type { VersionStore } from '../writing/versions';
import { authorPath, chapterKey, optionalSnapshot, summaryPath } from './files';
import { SettlementStore } from './store';

export class SettlementService {
  readonly store: SettlementStore;
  private readonly running = new Map<string, AbortController>();
  constructor(
    private readonly options: {
      workspace: WorkspaceService;
      library: LibraryService;
      personas: PersonaRegistry;
      models: ModelService;
      tasks: TaskRunnerPort;
      versions: VersionStore;
    }
  ) {
    this.store = new SettlementStore(options.workspace);
  }
  private key(args: SettlementIdArgs) {
    return `${args.rootPath}\0${args.batchId}`;
  }
  private async input(args: PrepareSettlementArgs, expandScenes = false) {
    await this.options.library.assertWorkspace(args.rootPath);
    await authorPath(args.rootPath, args.chapterPath);
    const layout = await this.options.workspace.getLayout(args.rootPath);
    if (!layout.ok) throw new Error(layout.message);
    const read = await this.options.workspace.readDocument({
      rootPath: args.rootPath,
      relativePath: args.chapterPath,
      maxBytes: 8 * 1024 * 1024
    });
    if (!read.ok) throw new Error(read.message);
    const chapter = read.document;
    if (chapter.head.status === 'invalid') throw new Error('请先修正章节元数据');
    const head = chapter.head.status === 'ok' ? chapter.head.frontmatter : {};
    if (
      head.kind !== 'chapter' &&
      (head.kind !== undefined || !args.chapterPath.startsWith(`${layout.layout.roles.manuscript.relativePath}/`))
    )
      throw new Error('只能结算章节');
    if (!chapter.head.body.trim()) throw new Error('章节内容为空');
    const assets = (await this.options.library.listAssets(args.rootPath)).assets;
    if (typeof head.id === 'string' && assets.filter(asset => asset.id === head.id).length > 1)
      throw new Error('章节稳定 id 重复，请先处理');
    let pack = await this.options.library.readPack(args.rootPath, args.packId);
    if (pack.sections.some(section => /^\.chaptale\/memory\/(?:notes|pending)(?:\/|$)/i.test(section.sourcePath)))
      throw new Error('结算不读取未确认观察或待确认提议，请从参考中移除');
    if ((await this.options.library.checkPack(args.rootPath, pack.id)).stale) throw new Error('结算参考已过期，请重组');
    const scenes = assets.filter(
      asset =>
        asset.kind === 'scene-card' &&
        asset.status !== 'archived' &&
        typeof asset.frontmatter.chapter === 'string' &&
        asset.links.some(link => link.link === asset.frontmatter.chapter && link.targetPath === args.chapterPath)
    );
    const requiredSources = new Map(
      scenes.map(scene => [
        scene.sourcePath,
        {
          sourcePath: scene.sourcePath,
          pinned: false,
          mode: 'full' as const,
          reason: '本章关联场景'
        }
      ])
    );
    for (const scene of scenes) {
      const related = await this.options.library.sceneReferences({
        rootPath: args.rootPath,
        scenePath: scene.sourcePath,
        selections: [],
        excluded: []
      });
      for (const selection of related.selections) {
        if (!requiredSources.has(selection.sourcePath))
          requiredSources.set(selection.sourcePath, {
            sourcePath: selection.sourcePath,
            pinned: false,
            mode: 'full',
            reason: selection.reason ?? '本章相关资产'
          });
      }
    }
    const missing = [...requiredSources.values()].filter(
      source => !pack.sections.some(section => section.sourcePath === source.sourcePath)
    );
    if (missing.length) {
      if (!expandScenes) throw new Error('关联场景已变化，请重新确认结算');
      pack = await this.options.library.freezePack({
        rootPath: args.rootPath,
        goal: pack.goal,
        budgetChars: pack.budgetChars,
        selections: [
          ...pack.sections.map(section => ({
            sourcePath: section.sourcePath,
            pinned: section.pinned,
            mode: section.mode,
            ...(section.quote ? { quote: section.quote } : {}),
            ...(section.reason ? { reason: section.reason } : {})
          })),
          ...missing
        ]
      });
    }
    const sources: SettlementBatch['sources'] = [];
    for (const section of pack.sections) {
      const sourceResult = await this.options.workspace.readDocument({
        rootPath: args.rootPath,
        relativePath: section.sourcePath,
        maxBytes: 8 * 1024 * 1024
      });
      if (!sourceResult.ok || sourceResult.document.contentHash !== section.sourceHash)
        throw new Error('参考来源已变化，请重新确认');
      const sourceHead = sourceResult.document.head;
      const kind = sourceHead.status === 'ok' ? sourceHead.frontmatter.kind : undefined;
      if (!sources.some(source => source.sourcePath === section.sourcePath))
        sources.push({
          sourcePath: section.sourcePath,
          contentHash: section.sourceHash,
          ...(typeof kind === 'string' ? { kind } : {})
        });
    }
    const plan: SettlementPlan = {
      chapterPath: args.chapterPath,
      chapterTitle: typeof head.title === 'string' ? head.title : args.chapterPath,
      expectedHash: chapter.contentHash,
      packId: pack.id,
      scenePaths: scenes.map(scene => scene.sourcePath),
      sources: sources.map(source => source.sourcePath),
      tokens: pack.tokens + estimateTextTokens(chapter.content)
    };
    await this.options.library.assertWorkspace(args.rootPath);
    return { chapter, head, pack, plan, sources, layout: layout.layout };
  }
  async prepare(args: PrepareSettlementArgs) {
    return (await this.input(args, true)).plan;
  }
  async start(args: StartSettlementArgs) {
    const runKey = this.key(args);
    if (this.running.has(runKey)) throw new Error('结算已经运行');
    const controller = new AbortController();
    this.running.set(runKey, controller);
    let created = false;
    let completedRun: { runId: string; outputRef: string } | undefined;
    try {
      const input = await this.input(args);
      if (input.chapter.contentHash !== args.expectedHash) throw new Error('正文已变化，请重新确认');
      const model = (await this.options.models.listModels()).models.find(
        value => value.provider === args.model.provider && value.id === args.model.modelId
      );
      if (!model?.authConfigured) throw new Error('结算模型不可用，请检查配置');
      const persona = await this.options.personas.get(args.rootPath, 'chapter-distiller');
      if (!persona || persona.execution !== 'task' || persona.output !== 'chapter-settlement')
        throw new Error('章节结算 persona 不可用');
      const sourceId = typeof input.head.id === 'string' ? input.head.id : undefined;
      const key = chapterKey(args.chapterPath, sourceId);
      await resolveArtifactPath(args.rootPath, summaryPath(key));
      const summaryBaseline = await optionalSnapshot(args.rootPath, summaryPath(key));
      const now = new Date().toISOString();
      const batch: SettlementBatch = {
        id: args.batchId,
        revision: 1,
        status: 'generating',
        chapterPath: args.chapterPath,
        chapterKey: key,
        chapterHash: args.expectedHash,
        chapterTitle: input.plan.chapterTitle,
        ...(typeof input.head.order === 'number' ? { chapterOrder: input.head.order } : {}),
        ...(sourceId ? { chapterSourceId: sourceId } : {}),
        packId: input.pack.id,
        personaId: persona.id,
        model: args.model,
        autoAcceptSummary: args.autoAcceptSummary,
        sources: input.sources,
        scenes: input.sources.filter(source => input.plan.scenePaths.includes(source.sourcePath)),
        worldDirectory: input.layout.roles.world.relativePath,
        ...(summaryBaseline ? { summaryBaseline } : {}),
        items: [],
        createdAt: now,
        updatedAt: now
      };
      await this.options.versions.save(input.chapter, 'settlement');
      await this.store.create(args.rootPath, batch);
      created = true;
      const result = await this.options.tasks.run({
        cwd: args.rootPath,
        persona,
        model: args.model,
        frozenContext: true,
        strictInputBudget: true,
        brief: `结算章节 ${args.chapterPath}。只提出本章明确发生的事实。角色和伏笔的 edits 必须精确引用参考原文，不得重写未提供的内容。`,
        text: input.chapter.content,
        contextPrompt: input.pack.prompt,
        files: [args.chapterPath, ...input.plan.scenePaths],
        packId: input.pack.id,
        memoryRefs: [
          `${args.chapterPath}#${args.expectedHash}`,
          ...input.sources.map(source => `${source.sourcePath}#${source.contentHash}`)
        ],
        trigger: 'ui-action',
        signal: controller.signal
      });
      if (result.status === 'success') {
        completedRun = { runId: result.runId, outputRef: result.outputRef };
        await this.store.finish(args.rootPath, args.batchId, result);
        if (args.autoAcceptSummary) {
          const ready = await this.store.read(args.rootPath, args.batchId);
          await this.store.resolve({
            rootPath: args.rootPath,
            batchId: args.batchId,
            revision: ready.revision,
            itemId: 'summary',
            action: 'accept'
          });
        }
      } else {
        await this.store.stop(
          args.rootPath,
          args.batchId,
          result.status === 'cancelled' ? 'cancelled' : 'failed',
          result.status === 'failed' ? result.errors.join('\n') : undefined,
          result.runId,
          result.status === 'failed' ? result.outputRef : undefined
        );
      }
      return this.store.details(args.rootPath, args.batchId);
    } catch (error) {
      if (created)
        await this.store.stop(
          args.rootPath,
          args.batchId,
          controller.signal.aborted ? 'cancelled' : 'failed',
          error instanceof Error ? error.message : String(error),
          completedRun?.runId,
          completedRun?.outputRef
        );
      throw error;
    } finally {
      this.running.delete(runKey);
    }
  }
  async list(args: { rootPath: string }) {
    const list = await this.store.list(args.rootPath);
    for (const batch of list.batches) {
      if (batch.status === 'generating' && !this.running.has(this.key({ ...args, batchId: batch.id })))
        await this.store.stop(args.rootPath, batch.id, 'failed', '上次结算已中断，未自动更新资产');
    }
    return this.store.list(args.rootPath);
  }
  async unsettled(args: { rootPath: string }) {
    const assets = (await this.options.library.listAssets(args.rootPath)).assets;
    const completed = (await this.store.list(args.rootPath)).batches.filter(batch => batch.status === 'completed');
    return assets
      .filter(
        asset =>
          (asset.kind === 'chapter' || (!asset.kind && asset.role === 'manuscript')) &&
          asset.status !== 'archived' &&
          asset.chars > 0 &&
          !completed.some(
            batch =>
              batch.chapterHash === asset.contentHash &&
              (batch.chapterPath === asset.sourcePath ||
                (asset.id &&
                  batch.chapterSourceId === asset.id &&
                  assets.filter(value => value.id === asset.id).length === 1))
          )
      )
      .map(asset => asset.sourcePath);
  }
  async cancel(args: SettlementIdArgs) {
    await this.options.library.assertWorkspace(args.rootPath);
    this.running.get(this.key(args))?.abort();
  }
}
