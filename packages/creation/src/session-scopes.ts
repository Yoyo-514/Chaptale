import type { SessionAssignment, SessionSelection, SessionState } from './contracts.ts';
import type { CreationRepository } from './repository.ts';

/** 会话归属固定；查看位置只能指向所选作品范围内的会话。 */
export function assignSession(repository: CreationRepository, input: SessionAssignment): SessionState {
  return repository.libraryTransaction(() => {
    if (!repository.hasWork(input.workId)) throw new Error('目标作品不存在');
    const owner = repository.getSessionWork(input.sessionId);
    if (owner !== null && owner !== input.workId) throw new Error('会话已固定归属其他作品');
    if (owner === null) repository.assignSession(input);
    return repository.readSessionState();
  });
}

export function selectSession(repository: CreationRepository, input: SessionSelection): SessionState {
  return repository.libraryTransaction(() => {
    if (input.workId !== null && !repository.hasWork(input.workId)) throw new Error('目标作品不存在');
    if (input.sessionId !== null && repository.getSessionWork(input.sessionId) !== input.workId)
      throw new Error('会话不属于所选作品范围');
    repository.selectSession(input);
    return repository.readSessionState();
  });
}
