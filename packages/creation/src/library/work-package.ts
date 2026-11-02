import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

import type { ImportWorkPackageInput, Work, WorkPackageInfo } from '../contracts.ts';
import type { CreationRepository } from '../repository.ts';
import type { CreationService } from '../service.ts';

/** 作品包导出与导入：包内是正式作品数据与资料文件，不含会话与待接受修改。 */
export class WorkPackageService {
  private readonly repository: CreationRepository;
  private readonly creation: CreationService;

  constructor(repository: CreationRepository, creation: CreationService) {
    this.repository = repository;
    this.creation = creation;
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

  /** 作品不存在时按原 ID 加入；asCopy 时另存为新作品；否则覆盖同一作品，原目录留作恢复快照。 */
  import(input: ImportWorkPackageInput): Work {
    absolutePath(input.path);
    return this.creation.commit(
      null,
      input.commandId,
      ['importWorkPackage', input.path, input.asCopy],
      { kind: 'library' },
      () => {
        const packaged = this.repository.readWorkPackage(input.path);
        if (this.repository.library.getTrashedWork(packaged.id))
          throw new Error('作品库回收站中有同一部作品，请先恢复或永久删除后再导入');
        const exists = this.repository.library.hasWork(packaged.id);
        if (input.asCopy) {
          const work = { ...packaged, id: randomUUID(), title: `${packaged.title}（副本）`, updatedAt: Date.now() };
          this.repository.installWorkPackage(input.path, work.id, false);
          this.repository.library.insertWork(work);
          return work;
        }
        const work = { ...packaged, updatedAt: Date.now() };
        if (!exists) {
          this.repository.installWorkPackage(input.path, work.id, false);
          this.repository.library.insertWork(work);
          return work;
        }
        // 覆盖后已打开的作品视图指向旧内容，先从工作台移除。
        const workbench = this.repository.library.readWorkbench();
        this.repository.library.writeWorkbench({
          activeWorkId: workbench.activeWorkId === work.id ? null : workbench.activeWorkId,
          works: workbench.works.filter(item => item.workId !== work.id)
        });
        this.repository.installWorkPackage(input.path, work.id, true);
        this.repository.library.updateWork(work);
        return work;
      }
    );
  }
}

function absolutePath(path: string): void {
  if (!isAbsolute(path)) throw new Error('作品包需要绝对路径');
}
