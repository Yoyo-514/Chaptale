import type { PersonaDefinition, RiskLevel } from '@chaptale/shared';

/** 工具运行时来源：builtin 为 Chaptale 内置工具；custom 为扩展注册工具（预留接口，默认目录无条目）。 */
export type ToolRuntime = 'builtin' | 'custom';
export type ToolScope = 'chat' | 'task';

export type ToolCatalogEntry = {
  name: string;
  runtime: ToolRuntime;
  scopes: readonly ToolScope[];
  riskLevel: RiskLevel;
  /** chat persona 省略 tools 时是否进入默认全集。 */
  defaultForChat: boolean;
};

export type SelectedSessionTools = {
  builtinToolNames: string[];
  customToolNames: string[];
};

const TASK_DISALLOWED_TOOLS = new Set(['todo_write', 'delegate', 'memory_save', 'memory_propose']);
const REVIEW_TOOLS = new Set(['memory_search']);

/**
 * 工具名称、运行时归属、作用域与 persona 收窄规则的唯一事实源。
 *
 * persona.tools 是完整能力白名单，不是提示性元数据：未登记工具先拒绝，
 * 再按 type/execution 收窄，避免子角色取得未治理工具或绕过作品记忆域。
 */
export class ToolCatalog {
  private readonly entriesByName: Map<string, ToolCatalogEntry>;

  constructor(entries: readonly ToolCatalogEntry[]) {
    this.entriesByName = new Map(entries.map(entry => [entry.name, entry]));
  }

  entries(): readonly ToolCatalogEntry[] {
    return [...this.entriesByName.values()];
  }

  resolveAllowed(persona: PersonaDefinition): string[] {
    if (persona.type === 'draft' || persona.type === 'rewrite') {
      return [];
    }

    // task persona 未声明 tools 表示纯分析（最小权限默认），不回落 chat 默认全集。
    if (persona.execution === 'task' && !persona.tools) {
      return [];
    }

    const declared = persona.tools
      ? this.entries()
          .filter(entry => persona.tools!.includes(entry.name))
          .map(entry => entry.name)
      : this.entries()
          .filter(entry => entry.defaultForChat)
          .map(entry => entry.name);

    if (persona.type === 'review') {
      return declared.filter(name => REVIEW_TOOLS.has(name));
    }

    if (persona.execution === 'task') {
      return declared.filter(name => !TASK_DISALLOWED_TOOLS.has(name));
    }

    return declared;
  }

  selectSessionTools(persona: PersonaDefinition, scope: ToolScope = 'chat'): SelectedSessionTools {
    const allowed = new Set(this.resolveAllowed(persona));
    const scoped = this.entries().filter(entry => entry.scopes.includes(scope) && allowed.has(entry.name));

    return {
      builtinToolNames: scoped.filter(entry => entry.runtime === 'builtin').map(entry => entry.name),
      customToolNames: scoped.filter(entry => entry.runtime === 'custom').map(entry => entry.name)
    };
  }
}

/**
 * Chaptale 的默认工具目录。
 *
 * bash 不在目录内：非代码创作软件不默认暴露任意命令执行能力。
 * custom 运行时为扩展注册预留：扩展工具经目录登记（含 scopes/riskLevel）后才对 persona 白名单可见。
 */
export function createDefaultToolCatalog(): ToolCatalog {
  return new ToolCatalog([
    { name: 'read', runtime: 'builtin', scopes: ['chat', 'task'], riskLevel: 'readonly', defaultForChat: true },
    { name: 'grep', runtime: 'builtin', scopes: ['chat', 'task'], riskLevel: 'readonly', defaultForChat: true },
    { name: 'find', runtime: 'builtin', scopes: ['chat', 'task'], riskLevel: 'readonly', defaultForChat: true },
    { name: 'ls', runtime: 'builtin', scopes: ['chat', 'task'], riskLevel: 'readonly', defaultForChat: true },
    { name: 'write', runtime: 'builtin', scopes: ['chat', 'task'], riskLevel: 'mutating', defaultForChat: true },
    { name: 'edit', runtime: 'builtin', scopes: ['chat', 'task'], riskLevel: 'mutating', defaultForChat: true },
    { name: 'web_search', runtime: 'builtin', scopes: ['chat', 'task'], riskLevel: 'mutating', defaultForChat: true },
    {
      name: 'fetch_content',
      runtime: 'builtin',
      scopes: ['chat', 'task'],
      riskLevel: 'mutating',
      defaultForChat: true
    },
    {
      name: 'get_search_content',
      runtime: 'builtin',
      scopes: ['chat', 'task'],
      riskLevel: 'readonly',
      defaultForChat: true
    },
    { name: 'todo_write', runtime: 'builtin', scopes: ['chat'], riskLevel: 'readonly', defaultForChat: true },
    { name: 'delegate', runtime: 'builtin', scopes: ['chat'], riskLevel: 'readonly', defaultForChat: true },
    { name: 'memory_save', runtime: 'builtin', scopes: ['chat'], riskLevel: 'readonly', defaultForChat: true },
    { name: 'memory_propose', runtime: 'builtin', scopes: ['chat'], riskLevel: 'readonly', defaultForChat: true },
    { name: 'memory_search', runtime: 'builtin', scopes: ['chat', 'task'], riskLevel: 'readonly', defaultForChat: true }
  ]);
}
