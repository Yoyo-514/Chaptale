function noop() {}

/**
 * 把回调风格的推送桥接为 AsyncGenerator：生产者 push/finish，消费者 drain。
 * finish 携带的第一个错误保留在 failure 上，由调用方决定是否抛出。
 */
export class AsyncMessageQueue<T> {
  private readonly queue: T[] = [];
  private done = false;
  private wake: () => void = noop;
  failure: Error | undefined;

  push(item: T) {
    this.queue.push(item);
    this.wake();
  }

  finish(failure?: Error) {
    if (failure && !this.failure) {
      this.failure = failure;
    }

    this.done = true;
    this.wake();
  }

  async *drain(): AsyncGenerator<T> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
        continue;
      }

      if (this.done) {
        return;
      }

      await new Promise<void>(resolve => {
        this.wake = resolve;
      });
      this.wake = noop;
    }
  }
}
