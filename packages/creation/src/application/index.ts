import { AgentRecordService } from '../agent/records.ts';
import { AgentRelationService } from '../agent/relations.ts';
import { CreationAgentService } from '../agent/service.ts';
import { TrashService } from '../content/trash.ts';
import type {
  CreationAgentCommand,
  CreationAgentCommands,
  CreationAgentContext,
  CreationAuthorCommand,
  CreationAuthorCommands,
  CreationCommands,
  CreationResult
} from '../contracts/index.ts';
import { DraftConflictError, EntryLocationConflictError, RevisionConflictError } from '../errors.ts';
import { addFiles, locateFile, prepareWorkFiles } from '../files/entry-files.ts';
import { exportFiles, fileCommandValidator, importFiles, prepareImport, type FileCommand } from '../files/exchange.ts';
import { WorkPackageService } from '../library/work-package.ts';
import { WorkTrashService } from '../library/work-trash.ts';
import { RecordService } from '../records/service.ts';
import { RelationService } from '../relations/service.ts';
import type { CreationRepository } from '../repository.ts';
import { ReviewService } from '../review/service.ts';
import { CreationService } from '../service.ts';
import { authorValidator, agentValidator } from './schema.ts';

export { agentInputs } from './schema.ts';
type AuthorValue = Extract<CreationAuthorCommands[keyof CreationAuthorCommands]['output'], { ok: true }>['value'];
type CreationValue = Extract<CreationCommands[keyof CreationCommands]['output'], { ok: true }>['value'];
type AgentValue = Extract<CreationAgentCommands[keyof CreationAgentCommands]['output'], { ok: true }>['value'];

/** 应用入口固定调用身份，校验请求并协调领域服务。 */
export class CreationApplication {
  private readonly service: CreationService;
  private readonly review: ReviewService;
  private readonly agent: CreationAgentService;
  private readonly trash: TrashService;
  private readonly workTrash: WorkTrashService;
  private readonly workPackages: WorkPackageService;
  private readonly records: RecordService;
  private readonly relations: RelationService;

  constructor(repository: CreationRepository) {
    this.service = new CreationService(repository);
    this.review = new ReviewService(repository, this.service);
    this.trash = new TrashService(repository, this.service, this.review);
    this.workTrash = new WorkTrashService(repository, this.service, this.review);
    this.workPackages = new WorkPackageService(repository, this.service, this.review);
    this.records = new RecordService(repository, this.service, this.review);
    this.relations = new RelationService(repository, this.service, this.review);
    this.agent = new CreationAgentService(
      repository,
      this.service,
      this.review,
      this.trash,
      new AgentRecordService(repository, this.service, this.review),
      new AgentRelationService(repository, this.service, this.review)
    );
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
        case 'addFiles':
          return { ok: true, value: await addFiles(this.service, file.input) };
        case 'inspectWorkPackage':
          return { ok: true, value: this.workPackages.inspect(file.input.path) };
        case 'exportWorkPackage':
          this.workPackages.export(file.input.workId, file.input.path);
          return { ok: true, value: null };
        case 'importWorkPackage':
          return { ok: true, value: this.workPackages.import(file.input) };
        case 'listWorkSnapshots':
          return { ok: true, value: this.workPackages.listSnapshots() };
        case 'restoreWorkSnapshot':
          return { ok: true, value: this.workPackages.restore(file.input) };
        case 'locateFile':
          return {
            ok: true,
            value: await locateFile(this.service, file.input.workId, file.input.entryId, file.input.trashed)
          };
        case 'prepareWorkFiles':
          return { ok: true, value: await prepareWorkFiles(this.service, file.input.workId) };
      }
    } catch (error) {
      return creationFailure(error);
    }
  }

  executeAgent<K extends keyof CreationAgentCommands>(
    context: CreationAgentContext,
    command: { method: K; input: CreationAgentCommands[K]['input'] }
  ): CreationAgentCommands[K]['output'];
  executeAgent(context: CreationAgentContext, command: unknown): CreationResult<AgentValue>;
  executeAgent(context: CreationAgentContext, command: unknown): CreationResult<AgentValue> {
    if (!agentValidator.Check(command)) return invalidRequest();
    try {
      return { ok: true, value: this.agent.execute(context, command as CreationAgentCommand) };
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
    if (!authorValidator.Check(command)) return invalidRequest();
    try {
      return { ok: true, value: this.executeBusiness(command as CreationAuthorCommand) };
    } catch (error) {
      return creationFailure(error);
    }
  }

  private executeBusiness(command: CreationAuthorCommand): AuthorValue {
    switch (command.method) {
      case 'listWorks':
        return this.service.listWorks();
      case 'readWritingGuidelines':
        return this.service.readWritingGuidelines(command.input.workId);
      case 'writeWritingGuidelines':
        return this.service.writeWritingGuidelines(command.input);
      case 'listEntries':
        return this.service.listEntries(command.input.workId);
      case 'searchDocuments':
        return this.service.searchDocuments(command.input);
      case 'readSessionState':
        return this.service.readSessionState();
      case 'selectSession':
        return this.service.selectSession(command.input);
      case 'forgetSessions':
        return this.service.forgetSessions(command.input.sessionIds);
      case 'readWorkbench':
        return this.service.readWorkbench();
      case 'writeWorkbench':
        return this.service.writeWorkbench(command.input);
      case 'createWork':
        return this.service.createWork(command.input);
      case 'createEntry':
        return this.service.createEntry(command.input);
      case 'saveDocument':
        return this.service.saveDocument(command.input);
      case 'readDocument':
        return this.service.readDocument(command.input.workId, command.input.documentId);
      case 'renameEntry':
        return this.service.renameEntry(command.input);
      case 'moveEntry':
        return this.service.moveEntry(command.input);
      case 'createRecord':
        return this.records.create(command.input);
      case 'updateRecord':
        return this.records.update(command.input);
      case 'moveRecord':
        return this.records.move(command.input);
      case 'removeRecord':
        return this.records.remove(command.input);
      case 'listSourceReviews':
        return this.records.sourceReviews(command.input.workId);
      case 'confirmChapter':
        return this.records.confirmChapter(command.input);
      case 'createRelation':
        return this.relations.create(command.input);
      case 'updateRelation':
        return this.relations.update(command.input);
      case 'removeRelation':
        return this.relations.remove(command.input);
      case 'listTrash':
        return this.trash.list(command.input.workId);
      case 'previewTrash':
        return this.trash.preview(command.input.workId, command.input.entryIds);
      case 'trashEntries':
        return this.trash.trash(command.input);
      case 'restoreTrash':
        return this.trash.restore(command.input);
      case 'purgeTrash':
        return this.trash.purge(command.input);
      case 'listTrashedWorks':
        return this.workTrash.list();
      case 'previewTrashWork':
        return this.workTrash.preview(command.input.workId);
      case 'trashWork':
        return this.workTrash.trash(command.input);
      case 'restoreWork':
        return this.workTrash.restore(command.input);
      case 'purgeWork':
        return this.workTrash.purge(command.input);
      case 'readTrashedDocument':
        return this.trash.readDocument(command.input.workId, command.input.documentId);
      case 'writeDraft':
        return this.service.writeDraft(command.input);
      case 'discardDraft':
        return this.service.discardDraft(command.input.workId, command.input.documentId, command.input.draftId);
      case 'readDraftState':
        return this.service.readDraftState(command.input.workId, command.input.documentId);
      case 'readRevision':
        return this.service.readRevision(command.input.workId, command.input.revisionId);
      case 'listRevisions':
        return this.service.listRevisions(command.input.workId, command.input.documentId);
      case 'snapshot':
        return this.service.snapshot(command.input.workId);
      case 'readChanges':
        return this.service.readChanges(command.input.cursor, command.input.limit);
      case 'listReviewItems':
        return this.review.items(command.input.sessionId);
      case 'listReviewResults':
        return this.review.listResults(command.input.sessionId);
      case 'reportReviewResults':
        return this.review.reportResults(command.input.sessionId, command.input.resultIds);
      case 'decidePending':
        return this.review.decidePending(command.input);
      case 'listPendingChanges':
        return this.review.list(command.input.workId, command.input.sessionId);
      case 'readReview':
        return this.review.read(command.input.changeId);
      case 'updateReview':
        return this.review.update(command.input);
      case 'decideReview':
        return this.review.decide(command.input);
      case 'updateRecordReview':
        return this.review.updateRecord(command.input);
      case 'updateRelationReview':
        return this.review.updateRelation(command.input);
      case 'relinkResource':
        return this.review.relink(command.input);
    }
  }

  close(): void {
    this.service.close();
  }
}
function invalidRequest(): CreationResult<never> {
  return { ok: false, error: { code: 'invalid-request', message: '作品请求参数无效' } };
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
