/** 应用传输只关联请求与响应；持久业务命令和事件游标由各业务契约定义。 */
export type CommandDefinitions<C> = { [K in keyof C]: { input: unknown; output: unknown } };

export type RpcCommand<C extends CommandDefinitions<C>> = {
  [K in keyof C]: { method: K; input: C[K]['input'] };
}[keyof C];

export interface RpcRequest<C extends CommandDefinitions<C>> {
  id: string;
  command: RpcCommand<C>;
}

export type RpcReply = { id: string; ok: true; value: unknown } | { id: string; ok: false; error: string };
export type RpcPacket<E> = { type: 'event'; event: E } | { type: 'reply'; reply: RpcReply };

export interface RpcClient<C extends CommandDefinitions<C>, E> {
  request<K extends keyof C>(method: K, input: C[K]['input']): Promise<C[K]['output']>;
  subscribe(listener: (event: E) => void): () => void;
}
