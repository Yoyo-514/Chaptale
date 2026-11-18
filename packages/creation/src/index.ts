export { CreationService } from './service.ts';
export { RevisionConflictError, DraftConflictError, EntryLocationConflictError } from './errors.ts';
export type {
  CreationRepository,
  LibraryRepository,
  WorkRepository,
  CommandCommit,
  CommitEffect,
  CommitResult,
  RecordRevision,
  RelationRevision,
  SearchNote,
  StoredVector,
  VectorIndexTarget,
  WorkSearchMatches,
  WorkSearchQuery
} from './repository.ts';
