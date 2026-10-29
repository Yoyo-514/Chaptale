import type { CreationCommands, CreationResult } from '@chaptale/creation/contracts';

import { getDesktopApi } from '@/utils/desktop-api';

export class CreationRequestError extends Error {
  readonly detail: Extract<CreationResult<never>, { ok: false }>['error'];
  constructor(detail: Extract<CreationResult<never>, { ok: false }>['error']) {
    super(detail.message);
    this.detail = detail;
  }
}

type Value<K extends keyof CreationCommands> = Extract<CreationCommands[K]['output'], { ok: true }>['value'];
export async function requestCreation<K extends keyof CreationCommands>(
  method: K,
  input: CreationCommands[K]['input']
): Promise<Value<K>> {
  // 作品契约只含纯 JSON；入队时捕获独立快照，去掉嵌套的响应式代理并隔离后续修改
  const snapshot = JSON.parse(JSON.stringify(input)) as typeof input;
  const result = await getDesktopApi().creation.request(method, snapshot);
  if (!result.ok) throw new CreationRequestError(result.error);
  return result.value as Value<K>;
}
