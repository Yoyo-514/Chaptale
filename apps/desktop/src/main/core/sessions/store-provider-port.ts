import type { SessionStore } from './store';

/**
 * 会话 store 提供端口。
 *
 * 运行时（AgentService）只需要「按 sessionId 拿到可读写的 store」，不需要列表、导出、
 * 删除、图片回读这些应用层仓储能力。依赖具体仓储类会让它多握住一批用不到的方法，
 * 也毫无必要地把 agent 钉在 sessions 这个 feature 上。
 *
 * 实现方是 features/sessions 的仓储；契约放 core 让双方都只面向它。
 */
export type SessionStoreProvider = {
  /** 打开已存在的会话；不存在时由实现方抛可读错误。 */
  open(sessionId: string): Promise<SessionStore>;
  /** 打开或创建（首轮对话前调用）；cwd 缺省时由实现方解析当前工作区。 */
  openOrCreate(sessionId: string, cwd?: string): Promise<SessionStore>;
};
