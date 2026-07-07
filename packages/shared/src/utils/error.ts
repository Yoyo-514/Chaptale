/** 把 unknown 错误统一转为可展示的 message 字符串。 */
export function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
