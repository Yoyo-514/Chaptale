import type { PersonaDefinition } from '@chaptale/shared';

const KNOWN_PERSONA_TOOLS = new Set([
  'read',
  'grep',
  'find',
  'ls',
  'write',
  'edit',
  'web_search',
  'fetch_content',
  'get_search_content',
  'todo_write',
  'delegate',
  'memory_save',
  'memory_propose',
  'memory_search'
]);

const TASK_DISALLOWED_TOOLS = new Set(['todo_write', 'delegate', 'memory_save', 'memory_propose']);
const REVIEW_TOOLS = new Set(['memory_search']);

/**
 * persona.tools 是完整能力白名单，不是提示性元数据。未知工具先拒绝，
 * 再按 execution/type 收窄，避免 task 子角色取得未治理工具或绕过作品记忆域。
 */
export function resolveAllowedPersonaTools(persona: PersonaDefinition): string[] {
  const declared = [...new Set(persona.tools ?? [])].filter(tool => KNOWN_PERSONA_TOOLS.has(tool));
  if (persona.type === 'draft' || persona.type === 'rewrite') return [];
  if (persona.type === 'review') return declared.filter(tool => REVIEW_TOOLS.has(tool));
  if (persona.execution === 'task') return declared.filter(tool => !TASK_DISALLOWED_TOOLS.has(tool));
  return declared;
}
