/** 编辑器内部防抖时序；自动保存开关由应用设置控制。 */
export const writingTiming = {
  recoveryDelayMs: 500,
  autoSaveDelayMs: 1200
} as const;
