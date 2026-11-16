import type { SessionSkillItem, SkillInvocationView } from '@chaptale/agent-host/protocol';

const SKILL_COMMAND_PREFIX = '/skill:';

/** 将技能标识与附加说明拼回 `/skill:<name> [text]`，供编辑、重发、复制与排队撤回统一还原。 */
export function formatSkillPrompt(text: string, skill?: SkillInvocationView): string {
  if (!skill) return text;
  const trimmed = text.trim();
  return trimmed ? `${SKILL_COMMAND_PREFIX}${skill.name} ${trimmed}` : `${SKILL_COMMAND_PREFIX}${skill.name}`;
}

/** 乐观待发消息尚未经宿主回传前，在前端拆分 `/skill:<name> [args]` 以保持气泡展示一致。 */
export function splitOutgoingSkillPrompt(raw: string): { text: string; skill?: SkillInvocationView } {
  if (!raw.startsWith(SKILL_COMMAND_PREFIX)) return { text: raw };
  const spaceIndex = raw.indexOf(' ');
  const name =
    spaceIndex === -1 ? raw.slice(SKILL_COMMAND_PREFIX.length) : raw.slice(SKILL_COMMAND_PREFIX.length, spaceIndex);
  if (!name) return { text: raw };
  const text = spaceIndex === -1 ? '' : raw.slice(spaceIndex + 1).trim();
  return { text, skill: { name } };
}

export interface DraftSkillSlashMatch {
  /** 去掉前缀 `/` 或 `/skill:` 后的过滤词。 */
  query: string;
  /** 首词长度，选中补全时替换该前缀范围。 */
  tokenLength: number;
}

/**
 * 识别输入框首词是否处于 `/` 技能搜索态。
 * 已选定 `/skill:<name> `（带空格进入正文输入）后自动收起菜单，不打扰后续打字。
 */
export function matchDraftSkillSlash(draft: string): DraftSkillSlashMatch | null {
  if (!draft.startsWith('/')) return null;
  const firstWhitespace = draft.search(/\s/u);
  if (firstWhitespace !== -1) return null;
  const rawQuery = draft.startsWith(SKILL_COMMAND_PREFIX) ? draft.slice(SKILL_COMMAND_PREFIX.length) : draft.slice(1);
  return { query: rawQuery, tokenLength: draft.length };
}

export function filterSessionSkills(items: readonly SessionSkillItem[], query: string): SessionSkillItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...items];
  return items.filter(
    item => item.name.toLowerCase().includes(normalized) || item.description.toLowerCase().includes(normalized)
  );
}

export function applySkillCompletion(draft: string, skillName: string): string {
  const firstWhitespace = draft.search(/\s/u);
  if (firstWhitespace === -1) return `${SKILL_COMMAND_PREFIX}${skillName} `;
  const rest = draft.slice(firstWhitespace + 1);
  return `${SKILL_COMMAND_PREFIX}${skillName} ${rest}`;
}
