// Renderer 侧统一工作区路径比较：历史筛选与 session store 必须保持同一语义。
export function normalizeWorkspacePath(value: string) {
  return value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
}

export function isSameWorkspacePath(left: string, right: string) {
  const normalizedLeft = normalizeWorkspacePath(left);
  const normalizedRight = normalizeWorkspacePath(right);

  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}
