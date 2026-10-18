import { randomUUID } from 'node:crypto';

import type { AgentClient, HostCommand, HostCommands, HostEvent, HostPacket, HostRequest } from '../protocol.ts';

/** 一条宿主连接的请求关联；断线只拒绝在途请求，连接层不重放业务命令。 */
export class HostConnection implements AgentClient {
  private readonly send: (request: HostRequest) => void;
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly listeners = new Set<(event: HostEvent) => void>();
  private error?: Error;

  constructor(send: (request: HostRequest) => void) {
    this.send = send;
  }

  request<K extends keyof HostCommands>(
    method: K,
    input: HostCommands[K]['input']
  ): Promise<HostCommands[K]['output']> {
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      this.pending.set(id, { resolve: value => resolve(value as HostCommands[K]['output']), reject });
      try {
        this.send({ id, command: { method, input } as HostCommand });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  subscribe(listener: (event: HostEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  receive(packet: HostPacket): void {
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
