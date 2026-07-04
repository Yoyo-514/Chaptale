import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { TSchema } from 'typebox';

import type { ChaptaleToolDefinition } from '../core/chaptale-tool';

export function toPiToolDefinition<TParameters extends TSchema>(
  tool: ChaptaleToolDefinition<TParameters>
): ToolDefinition<TParameters> {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    async execute(_toolCallId, params, signal) {
      const result = await tool.execute(params, signal);
      return {
        ...result,
        details: result.details ?? null
      };
    }
  };
}
