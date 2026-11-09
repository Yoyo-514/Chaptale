/**
 * 数据目录状态。ready 时 next 为已保存、重启后才使用的新位置；
 * unset 表示首次启动尚未选择；unavailable 表示记录的目录当前不可用。
 */
export type DataDirectoryStatus =
  | { kind: 'ready'; path: string; next: string | null }
  | { kind: 'unset'; suggested: string }
  | { kind: 'unavailable'; path: string; reason: string };
