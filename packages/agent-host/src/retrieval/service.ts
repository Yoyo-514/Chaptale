import { setTimeout as sleep } from 'node:timers/promises';

import type { CreationApplication, VectorText } from '@chaptale/creation/application';
import type {
  CreationAgentContext,
  CreationResult,
  SearchWorkInput,
  WorkSearchPage
} from '@chaptale/creation/contracts';

import type { EmbeddingSettingsSave, EmbeddingSettingsView, HostChange, VectorIndexStatus } from '../protocol/index.ts';
import type { EmbeddingConfiguration } from './config.ts';
import { embed, EmbeddingRequestError, type EmbeddingConnection } from './embeddings.ts';

/** 一次请求发送的段数；部分 OpenAI 兼容服务单次最多接受 10 段。 */
const batchSize = 10;
/** 服务繁忙或暂时连不上时，各次重试前的等待时间；服务给出 Retry-After 时按它等，最长 30 秒。 */
const retryDelays = [1000, 2000, 4000];
const longestRetryWait = 30_000;
const connectionTestText = '测试连接';
/** notice 说明语义检索没有做的原因，embedded 是这次检索前补算向量的段数；都交给 Agent 和作者看。 */
export type RetrievalSearchPage = WorkSearchPage & { notice?: string; embedded?: number };

interface Job {
  controller: AbortController;
  finished: Promise<void>;
  /** 开始时的索引状态，进度在它的基础上累加。 */
  base: VectorIndexStatus;
  done: number;
  total: number;
  doneCharacters: number;
}

export interface HostRetrievalOptions {
  configuration: EmbeddingConfiguration;
  /** 未接入作品应用的宿主不使用检索命令。 */
  creation: CreationApplication | undefined;
  emit: (change: HostChange) => void;
}

/** 检索服务设置，以及各作品向量索引的后台建立：每部作品同时只有一个任务，停止或失败时保留已经算好的段落。 */
export class HostRetrievalService {
  private readonly jobs = new Map<string, Job>();
  private readonly errors = new Map<string, string>();

  private readonly options: HostRetrievalOptions;

  constructor(options: HostRetrievalOptions) {
    this.options = options;
  }

  private get index() {
    // SAFETY: 检索命令只由接入了作品应用的宿主分发。
    return this.options.creation!.vectorIndex;
  }

  settings(): Promise<EmbeddingSettingsView | null> {
    return this.options.configuration.view();
  }

  /** 正在建立的索引用的是旧设置，保存后一并停止。 */
  async saveSettings(input: EmbeddingSettingsSave): Promise<EmbeddingSettingsView> {
    const saved = await this.options.configuration.save(input);
    await this.close();
    return saved;
  }

  async test(input: EmbeddingSettingsSave): Promise<{ dimensions: number }> {
    const [vector] = await embed(await this.options.configuration.resolve(input), [connectionTestText]);
    return { dimensions: vector!.length };
  }

  async status(workId: string): Promise<VectorIndexStatus> {
    return this.read(workId, await this.options.configuration.connection());
  }

  async build(workId: string, rebuild: boolean): Promise<VectorIndexStatus> {
    const connection = await this.options.configuration.connection();
    if (!connection) throw new Error('还没有设置检索服务');
    if (this.jobs.has(workId)) throw new Error('这部作品的向量索引正在建立');
    const target = { model: connection.model, dimensions: connection.dimensions };
    if (rebuild) this.index.reset(workId);
    else if (this.index.status(workId, target).state === 'stale')
      throw new Error('索引用的是另一个模型或维度，需要重建');
    this.index.start(workId, target);
    this.errors.delete(workId);

    const pending = this.index.pending(workId);
    if (pending.length === 0) return this.read(workId, connection);
    const job: Job = {
      controller: new AbortController(),
      finished: Promise.resolve(),
      base: this.read(workId, connection),
      done: 0,
      total: pending.length,
      doneCharacters: 0
    };
    this.jobs.set(workId, job);
    job.finished = this.run(workId, connection, pending, job);
    return this.progress(workId, job);
  }

  /** 停止这部作品的建立并等它结束；删除、覆盖或恢复作品前也要先停。 */
  async stop(workId: string): Promise<void> {
    const job = this.jobs.get(workId);
    job?.controller.abort();
    await job?.finished;
  }

  async cancel(workId: string): Promise<VectorIndexStatus> {
    await this.stop(workId);
    return this.status(workId);
  }

  /**
   * Agent 检索作品。带 question 时先补上检索范围里没算的向量（不设上限，停止生成可以中断），再连同问题的向量交给作品检索；
   * 语义检索做不了时只按关键词检索，并在 notice 里说明原因。
   */
  async search(
    context: CreationAgentContext,
    input: SearchWorkInput,
    signal?: AbortSignal
  ): Promise<CreationResult<RetrievalSearchPage>> {
    // SAFETY: 作品工具只由接入了作品应用的宿主声明。
    const creation = this.options.creation!;
    const keyword = () => creation.executeAgent(context, { method: 'searchWork', input });
    if (input.question === undefined) return keyword();

    const noticed = (result: CreationResult<WorkSearchPage>, notice: string): CreationResult<RetrievalSearchPage> =>
      result.ok ? { ok: true, value: { ...result.value, notice } } : result;
    const connection = await this.options.configuration.connection();
    if (!connection) return noticed(keyword(), '没有做语义检索：还没有设置检索服务。');
    if (!this.index.usable(input.workId, { model: connection.model, dimensions: connection.dimensions }))
      return noticed(keyword(), '没有做语义检索：这部作品还没有用当前的检索模型建立索引。');
    const missing = creation.missingSearchVectors(context, input);
    if (!missing.ok) return missing;

    const fill = missing.value;
    let question: Float32Array;
    try {
      for (let offset = 0; offset < fill.length; offset += batchSize)
        await this.save(input.workId, connection, fill.slice(offset, offset + batchSize), signal);
      [question] = (await embed(connection, [input.question], signal)) as [Float32Array];
    } catch (error) {
      if (!(error instanceof EmbeddingRequestError)) throw error;
      return noticed(keyword(), `没有做语义检索：${error.message}。`);
    }
    const result = creation.searchWork(context, input, question);
    return result.ok && fill.length > 0 ? { ok: true, value: { ...result.value, embedded: fill.length } } : result;
  }

  async close(): Promise<void> {
    await Promise.all([...this.jobs.keys()].map(workId => this.stop(workId)));
  }

  private read(workId: string, connection: EmbeddingConnection | null): VectorIndexStatus {
    const state = this.index.status(
      workId,
      connection && { model: connection.model, dimensions: connection.dimensions }
    );
    const error = this.errors.get(workId);
    const job = this.jobs.get(workId);
    return {
      workId,
      ...state,
      state: connection ? state.state : 'unconfigured',
      running: job ? { done: job.done, total: job.total } : null,
      ...(error !== undefined && { error })
    };
  }

  private progress(workId: string, job: Job): VectorIndexStatus {
    return {
      ...job.base,
      workId,
      indexed: job.base.indexed + job.done,
      pendingCharacters: job.base.pendingCharacters - job.doneCharacters,
      running: { done: job.done, total: job.total }
    };
  }

  private async run(
    workId: string,
    connection: EmbeddingConnection,
    pending: readonly VectorText[],
    job: Job
  ): Promise<void> {
    const { signal } = job.controller;
    try {
      for (let offset = 0; offset < pending.length; offset += batchSize) {
        const batch = pending.slice(offset, offset + batchSize);
        await this.save(workId, connection, batch, signal, true);
        job.done += batch.length;
        job.doneCharacters += batch.reduce((sum, item) => sum + item.text.length, 0);
        this.options.emit({ kind: 'vector-index', status: this.progress(workId, job) });
      }
    } catch (error) {
      if (!signal.aborted) this.errors.set(workId, error instanceof Error ? error.message : String(error));
    }
    this.jobs.delete(workId);
    this.options.emit({ kind: 'vector-index', status: this.read(workId, connection) });
  }

  /** 为一批文字算向量并保存。后台建立在服务繁忙时等一等再试，检索时不等。 */
  private async save(
    workId: string,
    connection: EmbeddingConnection,
    batch: readonly VectorText[],
    signal: AbortSignal | undefined,
    retry = false
  ): Promise<void> {
    const texts = batch.map(item => item.text);
    for (let attempt = 0; ; attempt++) {
      try {
        const vectors = await embed(connection, texts, signal);
        this.index.save(
          workId,
          batch.map(({ hash }, position) => ({ hash, vector: vectors[position]! }))
        );
        return;
      } catch (error) {
        const delay = retry ? retryDelays[attempt] : undefined;
        if (!(error instanceof EmbeddingRequestError) || !error.retryable || delay === undefined) throw error;
        await sleep(Math.min(error.retryAfterMs ?? delay, longestRetryWait), undefined, { signal });
      }
    }
  }
}
