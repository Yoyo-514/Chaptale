/**
 * 适配器共用的两件小事。
 *
 * 都是"每个服务商各写一遍就会写歪"的东西：把二进制交给 fetch 的类型收窄，
 * 以及把字节数说成人话（错误文案里要用）。
 */

/**
 * 把二进制原样交给 fetch。
 *
 * Node 的 fetch 本来就接受 Uint8Array，但类型定义里的 ArrayBufferView 带 ArrayBufferLike 泛型参数，
 * 直接传会被判为不匹配。这里只收一次窄，**不做数据拷贝**：上百 MB 的归档下多拷一份很吃亏。
 */
export function binaryBody(bytes: Uint8Array): NonNullable<RequestInit['body']> {
  return bytes as unknown as NonNullable<RequestInit['body']>;
}

/** 字节数说成 MB，保留一位小数：错误文案里给人看的是量级，不是精度。 */
export function formatMegabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}
