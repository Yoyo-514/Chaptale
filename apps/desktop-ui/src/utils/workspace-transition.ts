let guard: (() => Promise<boolean>) | undefined;

/** 生命周期只依赖一个窄回调，避免设置/作品与编辑器互相导入。 */
export function registerWorkspaceTransitionGuard(callback: () => Promise<boolean>) {
  guard = callback;
  return () => {
    if (guard === callback) guard = undefined;
  };
}

export async function confirmWorkspaceTransition(): Promise<boolean> {
  return guard ? guard() : true;
}
