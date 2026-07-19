/**
 * 从模型输出文本中提取 <output>…</output> 标签内的结构化 JSON。
 *
 * 模型经常在标签前后附带解释文字，或把 JSON 包在 ```json 代码围栏里；
 * 也可能在自我修正时输出多个 output 标签。提取器对这些情况保持容忍：
 * 取最后一个完整标签、剥离围栏后再解析。任何失败都返回判别式错误
 * 结果而不抛异常，方便调用方按失败原因决定重试或降级策略。
 */

/** 提取成功：raw 为标签内剥离围栏后的原始 JSON 字符串，value 为解析结果。 */
export type TaskOutputExtractSuccess = {
  ok: true;
  raw: string;
  value: unknown;
};

/** 提取失败的原因分类：无标签 / 标签内不是合法 JSON。 */
export type TaskOutputExtractFailure = {
  ok: false;
  reason: 'missing-output-tag' | 'invalid-json';
  message: string;
};

export type TaskOutputExtractResult = TaskOutputExtractSuccess | TaskOutputExtractFailure;

/** 匹配所有完整的 <output>…</output> 对；s 标志让内容可跨行。 */
const OUTPUT_TAG_PATTERN = /<output>([\s\S]*?)<\/output>/g;

/** 匹配整体被代码围栏包裹的内容，语言标注（如 json）可选。 */
const CODE_FENCE_PATTERN = /^```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```$/;

/** 若内容整体被 ``` 围栏包裹则剥掉围栏，否则原样返回。 */
function stripCodeFence(content: string): string {
  const match = CODE_FENCE_PATTERN.exec(content.trim());
  return match ? match[1].trim() : content.trim();
}

/**
 * 从模型文本中提取最后一个完整 <output> 标签内的 JSON。
 *
 * 取"最后一个"是因为模型自我修正时，后出现的输出通常是修正后的版本。
 */
export function extractTaskOutput(text: string): TaskOutputExtractResult {
  let lastInner: string | undefined;
  for (const match of text.matchAll(OUTPUT_TAG_PATTERN)) {
    lastInner = match[1];
  }

  if (lastInner === undefined) {
    return {
      ok: false,
      reason: 'missing-output-tag',
      message: '未找到完整的 <output>…</output> 标签'
    };
  }

  const raw = stripCodeFence(lastInner);
  try {
    return { ok: true, raw, value: JSON.parse(raw) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: 'invalid-json',
      message: `<output> 标签内不是合法 JSON：${detail}`
    };
  }
}
