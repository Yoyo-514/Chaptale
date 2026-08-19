import type { Static, TSchema } from 'typebox';
import { Compile, type Validator } from 'typebox/compile';

/**
 * 工具入参校验。
 *
 * `ToolDefinition.execute(params: Static<TParams>)` 声称参数已按 schema 收窄，
 * 但装配层走的是 AI SDK 的 `dynamicTool`——它的契约就是"schema 运行时才知道、
 * 入参不校验"，实际递进来的是模型原样吐出的对象。于是这个类型签名一直是假的：
 * 模型把 `{path}` 写成 `{wrong_key}` 时工具照常执行，内部拿到 `undefined`，
 * 多半抛错，而抛错在修好错误路径之前会连带废掉整个会话。
 *
 * 本模块补上那道运行时检查，让签名成真。
 *
 * 先 Convert 后 Check：模型经常把数字写成字符串（`"5"` 而非 `5`），这类
 * 无歧义的表述差异应当收编而不是打回——真正的结构性错误才值得占用一轮往返。
 */

const validators = new WeakMap<TSchema, Validator>();

/** 错误里回显的原始参数上限：write 类工具可能带整章正文，全量回显会撑爆上下文。 */
const MAX_ECHOED_ARGUMENTS = 1500;

export type ToolArgumentsResult<TParams extends TSchema> =
  | { ok: true; value: Static<TParams> }
  | { ok: false; message: string };

/**
 * 按 schema 校验并收编工具入参。
 *
 * 失败时给出的是**模型可读**的诊断：逐条列出路径与原因，并回显它实际发出的参数。
 * 模型据此自行改正重发，不需要用户介入。
 */
export function validateToolArguments<TParams extends TSchema>(
  toolName: string,
  schema: TParams,
  args: unknown
): ToolArgumentsResult<TParams> {
  const validator = getValidator(schema);
  // Convert 会就地改写传入值，先克隆：落盘与授权卡片仍应看到模型的原样输入。
  // 返回值才是权威结果——根为原始类型时无法原地改写。
  const converted = validator.Convert(structuredClone(args));

  if (validator.Check(converted)) {
    return { ok: true, value: converted as Static<TParams> };
  }

  const details = validator
    .Errors(converted)
    .map(error => `  - ${formatPath(error.instancePath)}：${error.message}`)
    .join('\n');

  return {
    ok: false,
    message:
      `工具 ${toolName} 的参数不符合 schema：\n${details || '  - 未知校验错误'}\n\n` +
      `你实际发出的参数：\n${echoArguments(args)}`
  };
}

function getValidator(schema: TSchema): Validator {
  const cached = validators.get(schema);

  if (cached) {
    return cached;
  }

  // 编译有成本，而工具 schema 是装配期常量：按 schema 对象身份缓存即可命中。
  const compiled = Compile(schema);
  validators.set(schema, compiled);

  return compiled;
}

/** JSON Pointer（`/a/b`）→ 点号路径；根路径给出可读占位。 */
function formatPath(instancePath: string): string {
  const normalized = instancePath.replace(/^\//, '').replaceAll('/', '.');

  return normalized || '（根）';
}

function echoArguments(args: unknown): string {
  let text: string;

  try {
    text = JSON.stringify(args, null, 2) ?? String(args);
  } catch {
    // 循环引用等：模型发来的一定是 JSON，此处仅为不让诊断本身抛错。
    text = String(args);
  }

  return text.length > MAX_ECHOED_ARGUMENTS ? `${text.slice(0, MAX_ECHOED_ARGUMENTS)}…（已截断）` : text;
}
