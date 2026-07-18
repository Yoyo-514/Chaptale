import type { SessionManager } from '@earendil-works/pi-coding-agent';

/**
 * pi SessionManager 的 append 操作默认可能延迟写盘。
 *
 * Chaptale 当前会话列表/删除逻辑依赖落盘文件即时可见，
 * 所以暂时集中隔离这个私有 API 兼容层，避免 _rewriteFile 泄漏到 repository 主流程。
 */
export function flushSessionFile(manager: SessionManager) {
  const internals = manager as unknown as { [key: string]: unknown; flushed?: boolean };
  const rewriteFile = internals['_rewriteFile'];

  if (typeof rewriteFile === 'function') {
    rewriteFile.call(manager);
  }

  internals.flushed = true;
}
