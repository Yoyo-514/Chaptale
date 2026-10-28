import type { TrashedWork, Work, WorkCommandInput } from './contracts.ts';
import type { CreationRepository } from './repository.ts';
import type { ReviewService } from './review/service.ts';
import type { CreationService } from './service.ts';

/** 作品库回收站：删除、恢复与永久清空都只在作品库中提交，作品数据库文件由平台移入系统回收站。 */
export class WorkTrashService {
  private readonly repository: CreationRepository;
  private readonly creation: CreationService;
  private readonly review: ReviewService;

  constructor(repository: CreationRepository, creation: CreationService, review: ReviewService) {
    this.repository = repository;
    this.creation = creation;
    this.review = review;
  }

  list(): TrashedWork[] {
    return this.repository.listTrashedWorks();
  }

  preview(workId: string): { pendingCount: number } {
    return { pendingCount: this.review.list(workId, null).length };
  }

  trash(input: WorkCommandInput): Work {
    return this.creation.commit(null, input.commandId, ['trashWork', input.workId], { kind: 'library' }, () => {
      const work = this.creation.listWorks().find(item => item.id === input.workId);
      if (!work) throw new Error('作品不存在');
      this.review.rejectWork(work.id);
      this.repository.trashWork(work.id, Date.now());
      const workbench = this.repository.readWorkbench();
      this.repository.writeWorkbench({
        activeWorkId: workbench.activeWorkId === work.id ? null : workbench.activeWorkId,
        works: workbench.works.filter(item => item.workId !== work.id)
      });
      return work;
    });
  }

  restore(input: WorkCommandInput): Work {
    return this.creation.commit(null, input.commandId, ['restoreWork', input.workId], { kind: 'library' }, () => {
      const work = this.trashed(input.workId);
      this.repository.restoreWork(work.id);
      return work;
    });
  }

  purge(input: WorkCommandInput): { files: string[] } {
    this.creation.commit(null, input.commandId, ['purgeWork', input.workId], { kind: 'library' }, () => {
      const work = this.trashed(input.workId);
      this.repository.purgeWork(work.id);
      return work;
    });
    return { files: this.repository.releaseWork(input.workId) };
  }

  private trashed(workId: string): Work {
    const trashed = this.repository.getTrashedWork(workId);
    if (!trashed) throw new Error('作品不在回收站中');
    const { deletedAt: _deletedAt, ...work } = trashed;
    return work;
  }
}
