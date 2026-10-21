import type { CommandDefinitions, RpcClient, RpcCommand, RpcPacket, RpcRequest } from '@chaptale/contracts';

/** 一条应用连接的请求关联；断线只拒绝在途请求，连接层不重放业务命令。 */
export class RpcConnection<C extends CommandDefinitions<C>, E> implements RpcClient<C, E> {
  private readonly send: (request: RpcRequest<C>) => void;
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly listeners = new Set<(event: E) => void>();
  private error?: Error;

  constructor(send: (request: RpcRequest<C>) => void) {
    this.send = send;
  }

  request<K extends keyof C>(method: K, input: C[K]['input']): Promise<C[K]['output']> {
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      const id = globalThis.crypto.randomUUID();
      this.pending.set(id, { resolve: value => resolve(value as C[K]['output']), reject });
      try {
        this.send({ id, command: { method, input } as RpcCommand<C> });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  subscribe(listener: (event: E) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  receive(packet: RpcPacket<E>): void {
    if (this.error) return;
    if (packet.type === 'event') {
      for (const listener of this.listeners) listener(packet.event);
      return;
    }
    const { reply } = packet;
    const pending = this.pending.get(reply.id);
    if (!pending) return;
    this.pending.delete(reply.id);
    if (reply.ok) pending.resolve(reply.value);
    else pending.reject(new Error(reply.error));
  }

  disconnect(error: Error): void {
    this.error = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.listeners.clear();
  }
}
