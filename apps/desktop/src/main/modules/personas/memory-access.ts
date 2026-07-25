import type { PersonaDefinition } from '@chaptale/shared';

import type { IndexDomain } from '../search/types';

const INDEX_DOMAINS: readonly IndexDomain[] = ['canon', 'notes', 'summaries'];

/**
 * persona 声明只能在角色类型的安全上限内做减法：review 永远不见 notes，
 * draft/rewrite 只能消费上游准备好的 Context Pack，不能直接查询作品库。
 */
export function resolveReadableIndexDomains(persona: PersonaDefinition): IndexDomain[] {
  const declared = new Set(persona.memory?.read ?? []);
  const cap = readableCap(persona.type);
  return INDEX_DOMAINS.filter(domain => declared.has(domain) && cap.has(domain));
}

function readableCap(type: PersonaDefinition['type']): ReadonlySet<IndexDomain> {
  if (type === 'review') return new Set(['canon', 'summaries']);
  if (type === 'draft' || type === 'rewrite') return new Set();
  return new Set(INDEX_DOMAINS);
}
