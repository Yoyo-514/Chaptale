import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';

import { estimateTextTokens } from '../../context/token-counter';
import type { ToolDefinition } from '../../tool-protocol/definition';
import { TOOL_RESULT_TOKEN_BUDGET, toModelToolOutput } from '../tool-output';
import { toAiSdkTools } from '../tools';

const overBudgetText = '中'.repeat(10_000); // 10k tokens，超出 8k 预算。

describe('toModelToolOutput', () => {
  it('字符串输出转为 text 标签；isError 转 error-text', () => {
    expect(toModelToolOutput('短文本', false)).toEqual({ type: 'text', value: '短文本' });
    expect(toModelToolOutput('失败', true)).toEqual({ type: 'error-text', value: '失败' });
  });

  it('项目工具形状 {text, details} 只取 text，details 不进模型上下文', () => {
    expect(toModelToolOutput({ text: '正文', details: { markdown: '整页正文' } }, false)).toEqual({
      type: 'text',
      value: '正文'
    });
  });

  it('超出预算：截断到预算内，保留首尾并插入省略标记', () => {
    const result = toModelToolOutput({ text: `开头证据-${overBudgetText}-结尾证据` }, false);

    expect(result).toMatchObject({ type: 'text' });
    const value = (result as { value: string }).value;
    expect(estimateTextTokens(value)).toBeLessThanOrEqual(TOOL_RESULT_TOKEN_BUDGET);
    expect(value).toContain('开头证据');
    expect(value).toContain('结尾证据');
    expect(value).toContain('工具输出超出预算');
  });

  it('已带合法标签原样透传（幂等），text 类补预算截断', () => {
    expect(toModelToolOutput({ type: 'json', value: { a: 1 } }, false)).toEqual({ type: 'json', value: { a: 1 } });
    expect(toModelToolOutput({ type: 'execution-denied', reason: '拒绝' }, false)).toEqual({
      type: 'execution-denied',
      reason: '拒绝'
    });

    const truncated = toModelToolOutput({ type: 'text', value: overBudgetText }, false) as { value: string };
    expect(truncated.value.length).toBeLessThan(overBudgetText.length);
    expect(estimateTextTokens(truncated.value)).toBeLessThanOrEqual(TOOL_RESULT_TOKEN_BUDGET);
  });

  it('其余对象 json 包装；null 归一为 null 值', () => {
    expect(toModelToolOutput({ denied: true, reason: '用户拒绝' }, false)).toEqual({
      type: 'json',
      value: { denied: true, reason: '用户拒绝' }
    });
    expect(toModelToolOutput(null, true)).toEqual({ type: 'error-json', value: null });
  });

  it('预算内文本保持逐字不变', () => {
    expect(toModelToolOutput({ text: '一章正文', details: { a: 1 } }, false)).toEqual({
      type: 'text',
      value: '一章正文'
    });
  });
});

describe('toAiSdkTools 的 toModelOutput 挂接', () => {
  it('execute 原始返回值经钩子截断进模型，details 被隔离', async () => {
    const definition: ToolDefinition = {
      name: 'read',
      label: '读取',
      description: '读文件',
      riskLevel: 'readonly',
      parameters: Type.Object({ path: Type.String() }),
      async execute() {
        return { text: `开头-${overBudgetText}-结尾`, details: { markdown: overBudgetText } };
      }
    };

    const toolSet = toAiSdkTools([definition], { sessionId: 's1' });
    const sdkTool = toolSet['read'];

    if (!sdkTool?.execute || !sdkTool.toModelOutput) {
      throw new Error('工具未正确装配');
    }

    const options = { toolCallId: 'call_1', messages: [], context: undefined };
    const raw = await sdkTool.execute({ path: 'a.txt' }, options);
    expect(raw).toEqual({ text: `开头-${overBudgetText}-结尾`, details: { markdown: overBudgetText } });

    const modelOutput = await sdkTool.toModelOutput({
      toolCallId: 'call_1',
      input: { path: 'a.txt' },
      output: raw
    });

    expect(modelOutput).toMatchObject({ type: 'text' });
    const value = (modelOutput as { value: string }).value;
    expect(estimateTextTokens(value)).toBeLessThanOrEqual(TOOL_RESULT_TOKEN_BUDGET);
    expect(value).toContain('工具输出超出预算');
    expect(value).not.toContain('markdown');
  });
});
