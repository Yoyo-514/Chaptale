import { Type, type TSchema } from 'typebox';
import { Compile } from 'typebox/compile';

import type { CreationAuthorCommand, CreationAuthorCommands, CreationCommands, CreationResult } from './contracts.ts';
import { DraftConflictError, EntryLocationConflictError, RevisionConflictError } from './errors.ts';
import { exportFiles, fileCommandValidator, importFiles, prepareImport, type FileCommand } from './file-exchange.ts';
import type { CreationRepository } from './repository.ts';
import { CreationService } from './service.ts';

const id = Type.String({ minLength: 1 });
const parentId = Type.Union([id, Type.Null()]);
const format = Type.Union([Type.Literal('txt'), Type.Literal('markdown')]);
const documentTarget = { workId: id, documentId: id };
const documentInput = {
  ...documentTarget,
  expectedRevisionId: id,
  title: Type.String(),
  format,
  content: Type.String()
};
const entryInput = {
  commandId: id,
  workId: id,
  parentId,
  title: Type.String(),
  section: Type.Union([Type.Literal('manuscript'), Type.Literal('resource')])
};
const object = <T extends Record<string, TSchema>>(fields: T) => Type.Object(fields, { additionalProperties: false });
const inputs = {
  createWork: object({
    commandId: id,
    title: Type.String(),
    kind: Type.Union([Type.Literal('novel'), Type.Literal('script')])
  }),
  createEntry: Type.Union([
    object({ ...entryInput, kind: Type.Literal('directory') }),
    object({ ...entryInput, kind: Type.Literal('document'), format, content: Type.String() })
  ]),
  saveDocument: object({ commandId: id, ...documentInput }),
  readDocument: object(documentTarget),
  renameDirectory: object({ commandId: id, workId: id, directoryId: id, expectedRevisionId: id, title: Type.String() }),
  moveEntry: object({
    commandId: id,
    workId: id,
    entryId: id,
    expectedParentId: parentId,
    expectedPosition: Type.Integer({ minimum: 0 }),
    parentId,
    beforeEntryId: parentId
  }),
  writeDraft: object({ ...documentInput, draftId: id, expectedDraftVersion: parentId }),
  discardDraft: object({ ...documentTarget, draftId: id }),
  readDraftState: object(documentTarget),
  readRevision: object({ workId: id, revisionId: id }),
  snapshot: object({ workId: parentId }),
  readChanges: object({
    cursor: object({ workId: parentId, sequence: Type.Integer({ minimum: 0 }), token: parentId }),
    limit: Type.Integer({ minimum: 1 })
  })
} satisfies Record<keyof CreationAuthorCommands, TSchema>;
const validator = Compile(
  Type.Union(Object.entries(inputs).map(([method, input]) => object({ method: Type.Literal(method), input })))
);

type AuthorValue = Extract<CreationAuthorCommands[keyof CreationAuthorCommands]['output'], { ok: true }>['value'];
type CreationValue = Extract<CreationCommands[keyof CreationCommands]['output'], { ok: true }>['value'];

/** 平台作者通道的应用入口；调用身份由入口固定，命令只携带业务参数。 */
export class CreationApplication {
  private readonly service: CreationService;

  constructor(repository: CreationRepository) {
    this.service = new CreationService(repository);
  }

  subscribe(listener: Parameters<CreationService['subscribe']>[0]): () => void {
    return this.service.subscribe(listener);
  }

  execute<K extends keyof CreationCommands>(command: {
    method: K;
    input: CreationCommands[K]['input'];
  }): Promise<CreationCommands[K]['output']>;
  execute(command: unknown): Promise<CreationResult<CreationValue>>;
  async execute(command: unknown): Promise<CreationResult<CreationValue>> {
    if (!fileCommandValidator.Check(command)) return this.executeAuthor(command);
    try {
      const file = command as FileCommand;
      switch (file.method) {
        case 'prepareImport':
          return { ok: true, value: await prepareImport(file.input.paths) };
        case 'importFiles':
          return { ok: true, value: await importFiles(this.service, file.input) };
        case 'exportFiles':
          return { ok: true, value: await exportFiles(this.service, file.input) };
      }
    } catch (error) {
      return creationFailure(error);
    }
  }

  executeAuthor<K extends keyof CreationAuthorCommands>(command: {
    method: K;
    input: CreationAuthorCommands[K]['input'];
  }): CreationAuthorCommands[K]['output'];
  executeAuthor(command: unknown): CreationResult<AuthorValue>;
  executeAuthor(command: unknown): CreationResult<AuthorValue> {
    if (!validator.Check(command))
      return { ok: false, error: { code: 'invalid-request', message: '作品请求参数无效' } };
    try {
      return { ok: true, value: this.executeBusiness(command as CreationAuthorCommand) };
    } catch (error) {
      return creationFailure(error);
    }
  }

  private executeBusiness(command: CreationAuthorCommand): AuthorValue {
    switch (command.method) {
      case 'createWork':
        return this.service.createWork(command.input);
      case 'createEntry':
        return this.service.createEntry(command.input);
      case 'saveDocument':
        return this.service.saveDocument(command.input);
      case 'readDocument':
        return this.service.readDocument(command.input.workId, command.input.documentId);
      case 'renameDirectory':
        return this.service.renameDirectory(command.input);
      case 'moveEntry':
        return this.service.moveEntry(command.input);
      case 'writeDraft':
        return this.service.writeDraft(command.input);
      case 'discardDraft':
        return this.service.discardDraft(command.input.workId, command.input.documentId, command.input.draftId);
      case 'readDraftState':
        return this.service.readDraftState(command.input.workId, command.input.documentId);
      case 'readRevision':
        return this.service.readRevision(command.input.workId, command.input.revisionId);
      case 'snapshot':
        return this.service.snapshot(command.input.workId);
      case 'readChanges':
        return this.service.readChanges(command.input.cursor, command.input.limit);
    }
  }

  close(): void {
    this.service.close();
  }
}

function creationFailure(error: unknown): CreationResult<never> {
  return {
    ok: false,
    error:
      error instanceof RevisionConflictError ||
      error instanceof DraftConflictError ||
      error instanceof EntryLocationConflictError
        ? error.toJSON()
        : { code: 'failed', message: error instanceof Error ? error.message : '作品请求失败' }
  };
}
