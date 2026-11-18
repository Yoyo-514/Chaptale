import { setTimeout as sleep } from 'node:timers/promises';

import type { CreationApplication, VectorText } from '@chaptale/creation/application';

import type { EmbeddingSettingsSave, EmbeddingSettingsView, HostChange, VectorIndexStatus } from '../protocol/index.ts';
import type { EmbeddingConfiguration } from './config.ts';
import { embed, EmbeddingRequestError, type EmbeddingConnection } from './embeddings.ts';

/** 一次请求发送的段数；部分 OpenAI 兼容服务单次最多接受 10 段。 */
const batchSize = 10;
/** 服务繁忙或暂时连不上时，各次重试前的等待时间；服务给出 Retry-After 时按它等，最长 30 秒。 */
const retryDelays = [1000, 2000, 4000];
const longestRetryWait = 30_000;
const connectionTestText = '测试连接';

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
        const vectors = await this.embed(
          connection,
          batch.map(item => item.text),
          signal
        );
        this.index.save(
          workId,
          batch.map(({ hash }, position) => ({ hash, vector: vectors[position]! }))
        );
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

  private async embed(
    connection: EmbeddingConnection,
    texts: readonly string[],
    signal: AbortSignal
  ): Promise<Float32Array[]> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await embed(connection, texts, signal);
      } catch (error) {
        const delay = retryDelays[attempt];
        if (!(error instanceof EmbeddingRequestError) || !error.retryable || delay === undefined) throw error;
        await sleep(Math.min(error.retryAfterMs ?? delay, longestRetryWait), undefined, { signal });
      }
    }
  }
}
