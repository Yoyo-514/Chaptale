/**
 * 将流式 delta 合并后按固定间隔刷新，避免每个 token 都触发一次 Vue 更新、Markdown 扫描和滚动测量。
 *
 * 30~50ms 是聊天软件常用的体感区间：足够顺滑，同时显著降低长文本流式渲染压力。
 */
export function useStreamingMessageBuffer(flush: (content: string) => void, flushIntervalMs = 40) {
  let buffer = '';
  let timerId: number | undefined;

  function flushNow() {
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      timerId = undefined;
    }

    if (!buffer) {
      return;
    }

    const content = buffer;
    buffer = '';
    flush(content);
  }

  function scheduleFlush() {
    if (timerId !== undefined) {
      return;
    }

    timerId = window.setTimeout(() => {
      timerId = undefined;
      flushNow();
    }, flushIntervalMs);
  }

  function push(content: string) {
    buffer += content;
    scheduleFlush();
  }

  function reset() {
    buffer = '';

    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      timerId = undefined;
    }
  }

  return {
    push,
    flushNow,
    reset
  };
}
