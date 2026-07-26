import { Type } from 'typebox';
import { describe, expect, it, vi } from 'vitest';

import type { ToolDefinition } from '../../../../core/tool-protocol/definition';
import { toPiToolDefinition } from '../adapter';

const parameters = Type.Object({ note: Type.String() }, { additionalProperties: false });

function createTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'demo_tool',
    label: '示例工具',
    description: '示例描述',
    parameters,
    execute: vi.fn(async () => ({ text: '完成', details: { ok: true } })),
    ...overrides
  };
}

describe('toPiToolDefinition', () => {
  it('passes name/label/description/schema through unchanged', () => {
    const piTool = toPiToolDefinition(createTool());

    expect(piTool.name).toBe('demo_tool');
    expect(piTool.label).toBe('示例工具');
    expect(piTool.description).toBe('示例描述');
    expect(piTool.parameters).toBe(parameters);
  });

  it('wraps execution results as a single text content block with details', async () => {
    const execute = vi.fn(async () => ({ text: '完成', details: { ok: true } }));
    const piTool = toPiToolDefinition(createTool({ execute }));
    const signal = new AbortController().signal;

    const result = await piTool.execute('call-1', { note: 'hi' }, signal, undefined, undefined as never);

    expect(execute).toHaveBeenCalledWith({ note: 'hi' }, signal);
    expect(result.content).toEqual([{ type: 'text', text: '完成' }]);
    expect(result.details).toEqual({ ok: true });
  });

  it('propagates tool execution failures to the runtime', async () => {
    const execute = vi.fn(async () => {
      throw new Error('工具失败');
    });
    const piTool = toPiToolDefinition(createTool({ execute }));

    await expect(piTool.execute('call-1', { note: 'hi' }, undefined, undefined, undefined as never)).rejects.toThrow(
      '工具失败'
    );
  });
});
