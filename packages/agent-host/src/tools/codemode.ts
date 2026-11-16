import { createCodemodeExtension, type ExtensionFactory } from '@earendil-works/pi-coding-agent';

export const codemodeToolName = 'codemode';
export const defaultCodemodeTimeoutMs = 120_000;
export const maxCodemodeTimeoutMs = 300_000;

export interface HostCodemodeOptions {
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
}

const optionsPrefix = '// @options:';
const supportedOptionKeys = new Set(['max_output_tokens', 'timeout_ms']);

function clampCodemodeTimeout(code: string, defaultTimeoutMs: number, maxTimeoutMs: number): string {
  if (code.trim() === '') return code;
  const lines = code.split('\n');
  if (lines.some((line, index) => index > 0 && line.trimStart().startsWith(optionsPrefix))) return code;
  const first = lines[0]!.replace(/\r$/, '').trimStart();
  if (!first.startsWith(optionsPrefix)) {
    return `${optionsPrefix} ${JSON.stringify({ timeout_ms: defaultTimeoutMs })}\n${code}`;
  }
  const newline = code.indexOf('\n');
  const rest = newline === -1 ? '' : code.slice(newline);
  if (rest.trim() === '') return code;
  let parsed: unknown;
  try {
    parsed = JSON.parse(first.slice(optionsPrefix.length).trim());
  } catch {
    return code;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return code;
  const fields = parsed as Record<string, unknown>;
  if (Object.keys(fields).some(key => !supportedOptionKeys.has(key))) return code;
  const declared = fields.timeout_ms;
  if (declared !== undefined && (typeof declared !== 'number' || !Number.isSafeInteger(declared) || declared <= 0)) {
    return code;
  }
  const timeoutMs = Math.min((declared as number | undefined) ?? defaultTimeoutMs, maxTimeoutMs);
  return `${optionsPrefix} ${JSON.stringify({ ...fields, timeout_ms: timeoutMs })}${rest}`;
}

/**
 * 复用 pi 原生 QuickJS Worker 沙箱执行工具组合脚本：
 * 关闭未接入授权的 models 接口，并将单次脚本超时约束在宿主上限内。
 */
export function createHostCodemodeExtension(options: HostCodemodeOptions = {}): ExtensionFactory {
  const defaultTimeoutMs = options.defaultTimeoutMs ?? defaultCodemodeTimeoutMs;
  const maxTimeoutMs = options.maxTimeoutMs ?? maxCodemodeTimeoutMs;
  const inner = createCodemodeExtension({ models: false });
  return pi => {
    const proxy = new Proxy(pi, {
      get(target, prop) {
        if (prop === 'registerTool') {
          return ((tool: Parameters<typeof pi.registerTool>[0]) =>
            target.registerTool({
              ...tool,
              execute(toolCallId, params, signal, onUpdate, ctx) {
                const input = params as { code: string };
                return tool.execute(
                  toolCallId,
                  { ...input, code: clampCodemodeTimeout(input.code, defaultTimeoutMs, maxTimeoutMs) },
                  signal,
                  onUpdate,
                  ctx
                );
              }
            })) as typeof pi.registerTool;
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    inner(proxy);
  };
}
