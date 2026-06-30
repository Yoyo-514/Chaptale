export type SSEOptions = {
  params: Record<string, any>;
  signal: AbortSignal;
};

/**
 * 使用原生 EventSource 发送 GET 请求
 */
export async function sse<T>(path: string, options: SSEOptions) {
  const { params, signal } = options;

  const search = new URLSearchParams(params);
  const url = `${path}?${search}`;

  return new Promise<AsyncGenerator<T>>((resolve, reject) => {
    let resolvers: PromiseWithResolvers<T | null>;

    const generator = async function* () {
      while (true) {
        resolvers = Promise.withResolvers<T | null>();
        const result = await resolvers.promise;
        if (result === null) {
          break;
        }
        yield result;
      }
    };

    const eventSource = new EventSource(url);

    eventSource.onopen = () => {
      // 返回生成器，这样调用方就可以 for await
      resolve(generator());
    };

    eventSource.onerror = () => {
      reject(new Error('EventSource connection error'));
      // 防止浏览器自动重连
      eventSource.close();
    };

    eventSource.onmessage = event => {
      if (!event.data) return;
      try {
        resolvers?.resolve(JSON.parse(event.data));
      } catch (error) {
        resolvers?.reject(error);
      }
    };

    // 自定义 close 事件
    eventSource.addEventListener('close', () => {
      resolvers?.resolve(null);
    });

    signal.addEventListener('abort', () => {
      eventSource.close();
      resolvers?.reject(new Error('Aborted'));
    });
  });
}

/**
 * 使用 fetch 发送 POST 请求
 */
export function ssePost<T>(path: string, options: SSEOptions) {
  const { params, signal } = options;

  return new Promise<AsyncGenerator<T>>((resolve, reject) => {
    let resolvers: PromiseWithResolvers<T | null>;

    const generator = async function* () {
      while (true) {
        resolvers = Promise.withResolvers<T | null>();
        const result = await resolvers.promise;
        if (result === null) {
          break;
        }
        yield result;
      }
    };

    fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params),
      signal
    })
      .then(async res => {
        // 这里拿到响应头，理论上要判断是不是SSE响应头
        if (!res.ok) {
          const text = (await res.text()) || res.statusText;
          throw new Error(text);
        }
        // 返回生成器，这样调用方就可以 for await
        resolve(generator());
        return res.body;
      })
      .then(async body => {
        // 这里拿到响应体
        if (!body) {
          throw new Error('No body present');
        }

        const decoder = new TextDecoder();

        // 迭代并解析响应体
        for await (const chunk of body) {
          const lines = decoder
            .decode(chunk, { stream: true })
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);

          for (const line of lines) {
            // 第一个冒号的位置
            const index = line.indexOf(':');

            if (index === -1) {
              // 忽略无效的行
              continue;
            }

            const key = line.slice(0, index).trim();
            const value = line.slice(index + 1).trim();

            // 注意这里的 setTimeout，同步循环会阻塞主线程，导致 resolvers?.resolve 后，generator 中的 await “卡住”
            // 使用 setTimeout 让 await 有机会执行
            setTimeout(() => {
              // 接收到 data: xxx
              if (key === 'data' && value) {
                resolvers?.resolve(JSON.parse(value));
              }
              // 接收到 event: close
              if (key === 'event' && value === 'close') {
                resolvers?.resolve(null);
              }
            });
          }
        }
      })
      .catch(err => {
        resolvers?.reject(err);
        reject(err);
      });
  });
}
