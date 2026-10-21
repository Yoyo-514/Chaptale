import type { CreationError } from './contracts.ts';

export class RevisionConflictError extends Error {
  readonly code = 'revision-conflict';
  readonly expectedRevisionId: string;
  readonly actualRevisionId: string;

  constructor(expectedRevisionId: string, actualRevisionId: string) {
    super('文稿已有新修订，请比较后再保存');
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
