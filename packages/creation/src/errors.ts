import type { CreationError } from './contracts/index.ts';
import type { WorkRepository } from './repository.ts';

export class RevisionConflictError extends Error {
  readonly code = 'revision-conflict';
  readonly expectedRevisionId: string;
  readonly actualRevisionId: string;

  constructor(expectedRevisionId: string, actualRevisionId: string) {
    super('内容已有新修订，请比较后再保存');
    this.name = 'RevisionConflictError';
    this.expectedRevisionId = expectedRevisionId;
    this.actualRevisionId = actualRevisionId;
  }

  toJSON(): CreationError {
    return {
      code: this.code,
      message: this.message,
      expectedRevisionId: this.expectedRevisionId,
      actualRevisionId: this.actualRevisionId
    };
  }
}

export class EntryLocationConflictError extends Error {
  readonly code = 'entry-location-conflict';
  readonly actualParentId: string | null;
  readonly actualPosition: number;

  constructor(actualParentId: string | null, actualPosition: number) {
    super('目录位置已变化，请刷新后再移动');
    this.name = 'EntryLocationConflictError';
    this.actualParentId = actualParentId;
    this.actualPosition = actualPosition;
  }

  toJSON(): CreationError {
    return {
      code: this.code,
      message: this.message,
      actualParentId: this.actualParentId,
      actualPosition: this.actualPosition
    };
  }
}

export class DraftConflictError extends Error {
  readonly code = 'draft-conflict';
  readonly actualVersion: string | null;

  constructor(actualVersion: string | null) {
    super('恢复草稿已变化，请重新读取后再操作');
    this.name = 'DraftConflictError';
    this.actualVersion = actualVersion;
  }

  toJSON(): CreationError {
    return { code: this.code, message: this.message, actualVersion: this.actualVersion };
  }
}

/** 回收站中的条目对读取和修改不可见，报错说明原因。 */
export function assertNotTrashed(work: WorkRepository, entryId: string): void {
  if (work.isTrashed(entryId)) throw new Error('条目在回收站中');
}
