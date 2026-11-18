import type { CreationRepository, StoredVector, VectorIndexTarget } from '../repository.ts';
import type { VectorText } from './vector-texts.ts';

export type { StoredVector, VectorIndexTarget } from '../repository.ts';
export type { VectorText } from './vector-texts.ts';

export interface VectorIndexState {
  /** none：作者还没为这部作品启动过；stale：索引用的是另一个模型或维度，需要重建。 */
  state: 'none' | 'stale' | 'ready';
  /** 正式内容里要算向量的段数，和其中已经算好的段数。 */
  total: number;
  indexed: number;
  /** 全部文字和其中还没算的文字的总长，建立或重建前告诉作者要发送多少。 */
  characters: number;
  pendingCharacters: number;
}

function sameTarget(a: VectorIndexTarget, b: VectorIndexTarget): boolean {
  return a.model === b.model && a.dimensions === b.dimensions;
}

/**
 * 一部作品的向量索引：记录作者启动时用的模型，按文字的 hash 保存向量。
 * 只管正式内容里哪些文字算过、哪些没算；调用 embedding 服务由宿主负责。
 */
export class VectorIndexService {
  private readonly repository: CreationRepository;
  private readonly formalTexts: (workId: string) => VectorText[];

  constructor(repository: CreationRepository, formalTexts: (workId: string) => VectorText[]) {
    this.repository = repository;
    this.formalTexts = formalTexts;
  }

  /** 索引是否可用于 target 指定的模型。 */
  usable(workId: string, target: VectorIndexTarget): boolean {
    const stored = this.repository.work(workId).vectorTarget();
    return stored !== undefined && sameTarget(stored, target);
  }

  /** target 为 null 表示还没有设置检索服务，此时已有的向量都不算数。 */
  status(workId: string, target: VectorIndexTarget | null): VectorIndexState {
    const work = this.repository.work(workId);
    const stored = work.vectorTarget();
    const texts = this.formalTexts(workId);
    const current = stored !== undefined && target !== null && sameTarget(stored, target);
    const known = current ? work.vectorHashes() : new Set<string>();
    const pending = texts.filter(text => !known.has(text.hash));
    const length = (items: readonly VectorText[]) => items.reduce((sum, text) => sum + text.text.length, 0);
    return {
      state: stored === undefined ? 'none' : current ? 'ready' : 'stale',
      total: texts.length,
      indexed: texts.length - pending.length,
      characters: length(texts),
      pendingCharacters: length(pending)
    };
  }

  /** 作者启动建立：记下索引用的模型。已有另一个模型的索引时先清空。 */
  start(workId: string, target: VectorIndexTarget): void {
    const work = this.repository.work(workId);
    const stored = work.vectorTarget();
    if (stored && sameTarget(stored, target)) return;
    work.clearVectorIndex();
    work.startVectorIndex(target);
  }

  /** 给出的文字里还没有向量的那些。 */
  missing(workId: string, texts: readonly VectorText[]): VectorText[] {
    const known = this.repository.work(workId).vectorHashes();
    return texts.filter(text => !known.has(text.hash));
  }

  /** 正式内容里还没有向量的文字。 */
  pending(workId: string): VectorText[] {
    return this.missing(workId, this.formalTexts(workId));
  }

  save(workId: string, vectors: readonly StoredVector[]): void {
    this.repository.work(workId).saveVectors(vectors);
  }

  reset(workId: string): void {
    this.repository.work(workId).clearVectorIndex();
  }
}
