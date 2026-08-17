import type { PersonaDefinition } from '@chaptale/shared';

import type { ToolDefinition } from '../../core/tool-protocol/definition';
import type { MemoryPendingStore } from '../memory/pending-store';
import { createMemoryProposeTool, createMemorySaveTool } from '../memory/tools';
import { resolveReadableIndexDomains } from '../personas/memory-access';
import type { PersonaRegistry } from '../personas/registry';
import type { TaskPersonaSpec } from '../personas/task-spec';
import type { MemorySearchService } from '../search/memory-search-service';
import { createMemorySearchTool } from '../search/memory-search-tool';
import { createDelegateTool, type DelegateToolContext } from '../subagent/delegate-tool';
import type { SubagentPool } from '../subagent/pool';
import type { TodoStore } from '../todo/store';
import { createTodoWriteTool } from '../todo/tool';
import { ContentStore } from '../web-tools/content-store';
import type { WebToolsSettingsStore } from '../web-tools/settings';
import { createWebTools } from '../web-tools/tools';

export type ChatToolContext = {
  todoStore: TodoStore;
  getSessionId: () => string | null;
  sessionId: string;
  cwd: string;
  persona: PersonaDefinition;
  subagentPool: SubagentPool;
  taskRunner: DelegateToolContext['taskRunner'];
  personaRegistry: Pick<PersonaRegistry, 'load'>;
  memoryPendingStore: MemoryPendingStore;
  memorySearchService: Pick<MemorySearchService, 'search'>;
  /** web 工具读取同一份 web-tools.json；缺省使用全局 fetch。 */
  webToolsSettingsStore: WebToolsSettingsStore;
};

export type TaskToolContext = {
  spec: TaskPersonaSpec;
  cwd: string;
  memorySearchService: Pick<MemorySearchService, 'search'>;
  onMemoryRead?: (refs: readonly string[]) => void;
};

/** 主对话内置工具的唯一注册点；会话工厂只负责 persona 白名单与工具适配。 */
export async function buildChatSessionTools(context: ChatToolContext): Promise<ToolDefinition[]> {
  const resolveCwd = async () => context.cwd;
  const memoryMatrix = context.persona.memory;
  // chat persona 省略 memory 时沿用主会话默认能力；显式声明只能收窄。
  const readableDomains = memoryMatrix
    ? resolveReadableIndexDomains(context.persona)
    : (['canon', 'notes', 'summaries'] as const);
  const memoryToolContext = { resolveCwd, getSessionId: context.getSessionId };

  return [
    createTodoWriteTool(context) as ToolDefinition,
    // 内容缓存随会话创建/销毁；设置存储全局共享，设置页修改下一次调用即生效。
    ...createWebTools({ settingsStore: context.webToolsSettingsStore, contentStore: new ContentStore() }),
    await createDelegateTool({
      pool: context.subagentPool,
      taskRunner: context.taskRunner,
      personaRegistry: context.personaRegistry,
      resolveCwd,
      sessionId: context.sessionId
    }),
    ...(!memoryMatrix || (memoryMatrix.write ?? []).includes('notes') ? [createMemorySaveTool(memoryToolContext)] : []),
    ...(!memoryMatrix || (memoryMatrix.propose ?? []).length > 0
      ? [createMemoryProposeTool({ ...memoryToolContext, pendingStore: context.memoryPendingStore })]
      : []),
    ...(readableDomains.length > 0
      ? [
          createMemorySearchTool({
            service: context.memorySearchService,
            resolveCwd,
            allowedDomains: readableDomains
          })
        ]
      : [])
  ];
}

/** task 内置工具与 chat 共用注册模块，但仍由 spec.tools 和已收窄 memory 域决定是否挂载。 */
export async function buildTaskSessionTools(context: TaskToolContext): Promise<ToolDefinition[]> {
  return context.spec.tools.includes('memory_search') && context.spec.memoryReadDomains.length > 0
    ? [
        createMemorySearchTool({
          service: context.memorySearchService,
          resolveCwd: () => context.cwd,
          allowedDomains: context.spec.memoryReadDomains,
          onRead: context.onMemoryRead
        })
      ]
    : [];
}
