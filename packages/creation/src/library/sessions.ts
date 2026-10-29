import type { SessionAssignment, SessionSelection, SessionState } from '../contracts.ts';
import type { LibraryRepository } from '../repository.ts';

/** 会话归属固定；查看位置只能指向所选作品范围内的会话。 */
export function assignSession(library: LibraryRepository, input: SessionAssignment): SessionState {
  return library.transaction(() => {
    if (!library.hasWork(input.workId)) throw new Error('目标作品不存在');
    const owner = library.getSessionWork(input.sessionId);
    if (owner !== null && owner !== input.workId) throw new Error('会话已固定归属其他作品');
    if (owner === null) library.assignSession(input);
    return library.readSessionState();
  });
}

export function selectSession(library: LibraryRepository, input: SessionSelection): SessionState {
  return library.transaction(() => {
    if (input.workId !== null && !library.hasWork(input.workId)) throw new Error('目标作品不存在');
    if (input.sessionId !== null && library.getSessionWork(input.sessionId) !== input.workId)
      throw new Error('会话不属于所选作品范围');
    library.selectSession(input);
    return library.readSessionState();
  });
}
