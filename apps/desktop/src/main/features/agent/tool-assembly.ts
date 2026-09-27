import type { PersonaDefinition } from '@chaptale/shared';

import type { ToolDefinition } from '../../core/tool-protocol/definition';
import { createFileTools } from '../file-tools/tools';
import type { MemoryPendingStore } from '../memory/pending/store';
import { createMemoryProposeTool, createMemorySaveTool } from '../memory/tools';
import { resolveReadableIndexDomains } from '../personas/memory-access';
import type { PersonaRegistry } from '../personas/registry';
import type { TaskPersonaSpec } from '../personas/task-spec';
import type { MemorySearchService } from '../search/memory/service';
import { createMemorySearchTool } from '../search/memory/tool';
import type { SkillProvider } from '../skills/provider-port';
import { createSkillReadTool } from '../skills/skill-read-tool';
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
  /** skill_read 通道：resolve 已确认存在适用技能时才传入（有技能才挂工具）。 */
  skillRead?: { provider: Pick<SkillProvider, 'load'>; personaId?: string; allowedNames?: readonly string[] };
};

export type TaskToolContext = {
  spec: TaskPersonaSpec;
  cwd: string;
  memorySearchService: Pick<MemorySearchService, 'search'>;
  onMemoryRead?: (refs: readonly string[]) => void;
  /** 与 chat 共用同一份 web-tools.json；内容缓存按任务会话隔离。 */
  webToolsSettingsStore: WebToolsSettingsStore;
  /** 永不开放给 AI 的目录：文件工具访问作品外路径时硬性拒绝。 */
  protectedRoots: readonly string[];
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
      : []),
    ...(context.skillRead
      ? [
          createSkillReadTool({
            skillsProvider: context.skillRead.provider,
            personaId: context.skillRead.personaId,
            allowedNames: context.skillRead.allowedNames,
            cwd: context.cwd
          })
        ]
      : [])
  ];
}

/**
 * task 内置工具与 chat 共用注册模块，但仍由 spec.tools 和已收窄 memory 域决定是否挂载。
 *
 * 文件与联网工具同样按声明挂载（catalog 已按 task 作用域和 persona 类型收窄过 spec.tools）：
 * 委派子任务的授权转到宿主会话，其余任务无人值守只放行只读。
 */
export async function buildTaskSessionTools(context: TaskToolContext): Promise<ToolDefinition[]> {
  const declared = new Set(context.spec.tools);

  return [
    ...(declared.has('memory_search') && context.spec.memoryReadDomains.length > 0
      ? [
          createMemorySearchTool({
            service: context.memorySearchService,
            resolveCwd: () => context.cwd,
            allowedDomains: context.spec.memoryReadDomains,
            onRead: context.onMemoryRead
          })
        ]
      : []),
    ...createWebTools({ settingsStore: context.webToolsSettingsStore, contentStore: new ContentStore() }),
    ...createFileTools(context.cwd, { protectedRoots: context.protectedRoots })
  ].filter(tool => declared.has(tool.name));
}
