/** 查询结果只能引用 workspace 内的规范相对路径，拒绝绝对路径与任意父级跳转。 */
export function isSafeWorkspaceRelativePath(sourcePath: string): boolean {
  const normalized = sourcePath.replaceAll('\\', '/');
  if (!normalized || /^(?:[a-z]:|\/)/iu.test(normalized)) return false;
  return !normalized.split('/').some(segment => segment === '..');
}

export function safeWorkspaceRelativePath(sourcePath: string): string {
  const normalized = sourcePath.replaceAll('\\', '/');
  return isSafeWorkspaceRelativePath(normalized) ? normalized : '[invalid-path]';
}
