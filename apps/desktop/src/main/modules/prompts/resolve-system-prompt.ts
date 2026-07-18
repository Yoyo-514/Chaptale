import { DEFAULT_SYSTEM_PROMPT } from './default-system-prompt';

/** 为 pi 的 SYSTEM.md 发现结果提供 Chaptale 默认回退。 */
export function resolveSystemPrompt(discoveredPrompt: string | undefined) {
  return discoveredPrompt?.trim() ? discoveredPrompt : DEFAULT_SYSTEM_PROMPT;
}
