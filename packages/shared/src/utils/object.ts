/** 将外部 unknown 数据收窄为普通键值对象，数组不视为配置对象。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function readString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

export function readFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function readBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

export function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}

/**
 * 递归移除对象中的 undefined 字段，生成适合 JSON 持久化的稀疏配置。
 * 数组保持长度和位置，不过滤其中的 undefined，避免改变有序数据语义。
 */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => stripUndefined(item)) as T;
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefined(item)])
  ) as T;
}
