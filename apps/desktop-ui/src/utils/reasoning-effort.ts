import type { ChaptaleReasoningEffort } from '@chaptale/ipc-contract';

/**
 * 档位展示名，由低到高。
 *
 * 用 `Record<ChaptaleReasoningEffort, string>` 而不是数组：契约里新增一个档位时，
 * 这里漏配即编译失败——若是数组，漏掉的档位只会在界面上静静地不出现。
 * 键序即声明序，两处下拉共用同一顺序。
 */
export const REASONING_EFFORT_LABELS = {
  none: 'none（不推理）',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh'
} satisfies Record<ChaptaleReasoningEffort, string>;

export const REASONING_EFFORT_VALUES = Object.keys(REASONING_EFFORT_LABELS) as ChaptaleReasoningEffort[];
