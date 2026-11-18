import type { CreationApplication } from '@chaptale/creation/application';
import type { CreationAgentContext, Entry, SearchWorkInput, WorkSearchPage } from '@chaptale/creation/contracts';

/** 没有待接受修改的会话，检索到的就是正式内容。 */
const formal: CreationAgentContext = { sessionId: 'formal-search', mode: 'discuss' };

type Query = Pick<SearchWorkInput, 'workId' | 'query'> & Partial<SearchWorkInput>;

export function searchWork(
  app: CreationApplication,
  input: Query,
  context: CreationAgentContext = formal
): WorkSearchPage {
  const result = app.executeAgent(context, { method: 'searchWork', input: { offset: 0, limit: 10, ...input } });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** 命中的条目，按返回顺序。 */
export function searchEntries(app: CreationApplication, input: Query, context?: CreationAgentContext): Entry[] {
  return searchWork(app, input, context).hits.flatMap(hit => (hit.kind === 'entry' ? [hit.entry] : []));
}
