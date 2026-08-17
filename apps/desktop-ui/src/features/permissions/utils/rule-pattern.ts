/**
 * 由授权请求的参数摘要推导一条「够用但不过宽」的规则 pattern。
 *
 * 主进程的求值器支持 `tool(前缀*)` 与 `tool(精确值)` 两种参数级形式
 * （见 main/features/permissions/engine.ts），但此前授权卡片只会生成裸工具名，
 * 于是「始终允许」永远是「这个工具的所有调用都放行」——参数级规则只能手写进
 * .chaptale/permissions.json，普通作者根本用不上。
 *
 * 收窄策略按摘要形态分三种：
 * - URL：授到来源（同站后续请求不再打断）；
 * - 路径：授到所在目录（逐章写作时同目录反复写入只需授权一次）；
 * - 其余（命令、查询词等）：精确匹配，不做任何猜测性放宽。
 */
export type ScopedRule = {
  pattern: string;
  /** 按钮上展示的收窄范围，需短到能塞进授权卡片一行。 */
  scopeLabel: string;
};

const URL_ORIGIN_PATTERN = /^(https?:\/\/[^/\s]+)(?:\/|$)/i;

export function deriveScopedRule(toolName: string, subject: string | undefined): ScopedRule | undefined {
  const trimmed = subject?.trim();

  if (!trimmed) {
    return undefined;
  }

  const origin = URL_ORIGIN_PATTERN.exec(trimmed);

  if (origin) {
    return { pattern: `${toolName}(${origin[1]}/*)`, scopeLabel: origin[1]! };
  }

  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));

  if (separator > 0) {
    const directory = trimmed.slice(0, separator + 1);
    return { pattern: `${toolName}(${directory}*)`, scopeLabel: directory };
  }

  // 精确规则与裸工具名等价时不必多给一个按钮（例如摘要恰好就是工具名本身）。
  return trimmed === toolName ? undefined : { pattern: `${toolName}(${trimmed})`, scopeLabel: trimmed };
}
