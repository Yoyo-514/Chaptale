/**
 * 历史会话恢复后的安全上下文。
 * cwd/scope 一旦从持久化会话解析出来，就不能再回退到 UI 当前 workspace。
 */
export type SessionCtx = {
  sessionId: string;
  cwd: string;
  scope: 'global' | 'workspace';
};

/** 把运行时会话对象与其持久化安全上下文一起传递，避免调用链丢失 workspace 归属。 */
export type BoundSession<TSession> = {
  session: TSession;
  ctx: SessionCtx;
};
