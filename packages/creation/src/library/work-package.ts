import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

import type {
  ImportWorkPackageInput,
  WorkCommandInput,
  WorkPackageInfo,
  WorkReplacement,
  WorkSnapshot
} from '../contracts/index.ts';
import type { CreationRepository } from '../repository.ts';
import type { ReviewService } from '../review/service.ts';
import type { CreationService } from '../service.ts';

/** 作品包导出与导入：包内是正式作品数据与资料文件，不含会话与待接受修改。 */
export class WorkPackageService {
  private readonly repository: CreationRepository;
  private readonly creation: CreationService;
  private readonly review: ReviewService;

  constructor(repository: CreationRepository, creation: CreationService, review: ReviewService) {
    this.repository = repository;
    this.creation = creation;
    this.review = review;
  }

  inspect(path: string): WorkPackageInfo {
    absolutePath(path);
    const work = this.repository.readWorkPackage(path);
    return { work, exists: this.repository.library.hasWork(work.id) };
  }

  export(workId: string, path: string): void {
    absolutePath(path);
    this.repository.exportWorkPackage(workId, path);
  }

  /**
   * 作品不存在时按原 ID 加入；asCopy 时另存为新作品；否则覆盖同一作品，原目录留作导入前快照。
   * 先在旁边展开并升级作品包，再在作品库事务内换上目录；提交失败时换回原目录。
   */
  import(input: ImportWorkPackageInput): WorkReplacement {
    absolutePath(input.path);
    const packaged = this.repository.readWorkPackage(input.path);
    const workId = input.asCopy ? randomUUID() : packaged.id;
    this.repository.stageWorkPackage(input.path, workId);
    let undo: (() => void) | undefined;
    try {
      const work = this.creation.commit(
        null,
        input.commandId,
        ['importWorkPackage', input.path, input.asCopy],
        { kind: 'library' },
        () => {
          if (this.repository.library.getTrashedWork(packaged.id))
            throw new Error('作品库回收站中有同一部作品，请先恢复或永久删除后再导入');
          const now = Date.now();
          if (input.asCopy) {
            const copy = { ...packaged, id: workId, title: `${packaged.title}（副本）`, updatedAt: now };
            this.repository.library.insertWork(copy);
            undo = this.repository.installStagedWork(workId, null);
            return copy;
          }
          const imported = { ...packaged, updatedAt: now };
          const previous = this.repository.library.listWorks().find(item => item.id === workId);
          if (!previous) {
            this.repository.library.insertWork(imported);
            undo = this.repository.installStagedWork(workId, null);
            return imported;
          }
          this.replaceContent(workId);
          this.repository.library.updateWork(imported);
          undo = this.repository.installStagedWork(workId, previous);
          return imported;
        }
      );
      return { work, files: this.repository.pruneWorkSnapshots(work.id) };
    } catch (error) {
      undo?.();
      throw error;
    } finally {
      this.repository.discardStagedWork(workId);
    }
  }

  listSnapshots(): WorkSnapshot[] {
    return this.repository.listWorkSnapshots();
  }

  /** 换回导入前快照与当时的作品信息；换下的目录交给平台移入系统回收站。 */
  restore(input: WorkCommandInput): WorkReplacement {
    let replaced: { replaced: string; undo: () => void } | undefined;
    try {
      const work = this.creation.commit(
        null,
        input.commandId,
        ['restoreWorkSnapshot', input.workId],
        { kind: 'library' },
        () => {
          if (!this.repository.library.hasWork(input.workId)) throw new Error('作品不存在');
          const snapshot = this.repository.readWorkSnapshot(input.workId);
          this.replaceContent(input.workId);
          this.repository.library.updateWork(snapshot);
          replaced = this.repository.restoreWorkSnapshot(input.workId);
          return snapshot;
        }
      );
      return { work, files: replaced ? [replaced.replaced] : [] };
    } catch (error) {
      replaced?.undo();
      throw error;
    }
  }

  /** 作品内容整体替换：待审修改的基线随之失效，全部拒绝；已打开的作品视图指向旧内容，从工作台移除。 */
  private replaceContent(workId: string): void {
    this.review.rejectWork(workId);
    const workbench = this.repository.library.readWorkbench();
    this.repository.library.writeWorkbench({
      activeWorkId: workbench.activeWorkId === workId ? null : workbench.activeWorkId,
      works: workbench.works.filter(item => item.workId !== workId)
    });
  }
}

function absolutePath(path: string): void {
  if (!isAbsolute(path)) throw new Error('作品包需要绝对路径');
}
