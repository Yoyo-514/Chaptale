import type { SessionSelection, SessionState } from '../contracts/index.ts';
import type { LibraryRepository } from '../repository.ts';

/** 查看位置按范围记录；会话归属由宿主按会话文件所在目录确定。 */
export function selectSession(library: LibraryRepository, input: SessionSelection): SessionState {
  return library.transaction(() => {
    if (input.workId !== null && !library.hasWork(input.workId)) throw new Error('目标作品不存在');
    library.selectSession(input);
    return library.readSessionState();
  });
}
