import type { ChatMessage, NestedToolView, ToolResultInfo } from '@chaptale/agent-host/protocol';

import { formatSkillPrompt } from './skills';

export interface ToolEntryTarget {
  workId?: string;
  entryId: string;
  title: string;
}

export type ToolActivity = {
  kind: 'tool';
  id: string;
  key: string;
  name: string;
  /** 「读取了 正文/第一章.md」这样的一句话，作者不必看参数也知道助手做了什么。 */
  summary: string;
  entryTarget?: ToolEntryTarget;
  input: unknown;
  preview?: Record<string, unknown>;
  info?: ToolResultInfo;
  children?: ToolActivity[];
  nested?: boolean;
  incomplete?: boolean;
  result?: { text: string; error: boolean };
};
export type ThinkingActivity = { kind: 'thinking'; key: string; text: string };
export type RetryTarget = {
  entryId: string;
  text: string;
  editorContext?: ChatMessage['editorContext'];
};
export type TranscriptItem =
  | {
      kind: 'user';
      key: string;
      entryId?: string;
      text: string;
      compacted?: boolean;
      editorContext?: ChatMessage['editorContext'];
      skill?: ChatMessage['skill'];
      branch?: ChatMessage['branch'];
    }
  /** 会话压缩总结，只读；它之前的对话已由总结代替。 */
  | { kind: 'summary'; key: string; text: string }
  /** 作者逐处处理结果，只读，完整正式稿留在模型上下文中。 */
  | { kind: 'notice'; key: string; text: string; outcomes: NonNullable<ChatMessage['outcomes']> }
  | {
      kind: 'assistant';
      key: string;
      /** 原消息下标，流式渲染按它区分缓存。 */
      index: number;
      thinking?: ThinkingActivity;
      text: string;
      error: boolean;
      errorMessage?: string;
      aborted?: boolean;
      tools: ToolActivity[];
      retryTarget?: RetryTarget;
      /** 已被压缩总结代替，只供查看。 */
      compacted?: boolean;
    };

const verbs: Record<string, [done: string, pending: string]> = {
  read: ['读取了', '读取'],
  ls: ['查看了目录', '查看目录'],
  find: ['查找了', '查找'],
  grep: ['搜索了', '搜索']
};

/** 工具参数里最能说明对象的那一项；未知工具只显示名称。 */
function target(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const fields = input as Record<string, unknown>;
  const value = [fields.pattern, fields.path, fields.file_path].find(item => typeof item === 'string' && item);
  const where = typeof fields.pattern === 'string' && typeof fields.path === 'string' ? ` · ${fields.path}` : '';
  return value ? `${value as string}${where}` : '';
}

function toolAction(name: string, input: unknown, info?: ToolResultInfo): [string, string] {
  if (info?.skillName) {
    return name === 'read' ? ['加载技能', '项'] : ['查阅技能', '次'];
  }
  const fields = input as Record<string, unknown> | undefined;
  const section = info?.section ?? fields?.section;
  const subject = section === 'resource' ? '资料' : section === 'manuscript' ? '文稿' : '正文';
  switch (name) {
    case 'work_read':
    case 'read':
      return ['读取', '份'];
    case 'work_write':
      if (!fields) return [`写入${subject}`, '份'];
      return [fields.entryId ? `修改${subject}` : `新建${subject}`, '份'];
    case 'work_edit':
      return [`修改${subject}`, '份'];
    case 'work_record_write':
      if (!fields) return ['写入事件', '条'];
      return [fields.remove ? '移除事件' : fields?.recordId ? '修改事件' : '记录事件', '条'];
    case 'work_relation_write':
      if (!fields) return ['写入关系', '条'];
      return [fields.remove ? '移除关系' : fields?.relationId ? '修改关系' : '建立关系', '条'];
    case 'work_ls':
      return [fields?.workId === null ? '查看作品列表' : '查看目录', '次'];
    case 'ls':
      return ['查看目录', '次'];
    case 'work_find':
    case 'find':
      return ['查找', '次'];
    case 'work_grep':
    case 'work_search':
    case 'grep':
      return ['检索', '次'];
    case 'work_mkdir':
      return ['新建目录', '个'];
    case 'work_mv':
      return [
        typeof fields?.title === 'string' && fields.parentId === undefined && fields.position === undefined
          ? '改名'
          : '移动条目',
        '项'
      ];
    case 'work_rm':
      return ['移除条目', '项'];
    case 'work_record_ls':
      return ['查看事件', '次'];
    case 'work_relation_ls':
      return ['查看关系', '次'];
    case 'edit':
      return ['编辑', '份'];
    case 'write':
      return ['写入', '份'];
    case 'bash':
    case 'powershell':
      return ['执行命令', '次'];
    case 'codemode':
      return ['执行脚本', '次'];
    case 'tool_search':
      return ['查找工具', '次'];
    default:
      return ['调用工具', '次'];
  }
}

/** 业务工具以对象标题和结果元数据呈现，原生文件工具沿用可读路径。 */
export function describeTool(
  name: string,
  input: unknown,
  done: boolean,
  failed = false,
  info?: ToolResultInfo
): string {
  const [action] = toolAction(name, input, info);
  if (info?.skillName) {
    return `${failed ? '未能' : ''}${action}《${info.skillName}》`;
  }
  if (name.startsWith('work_')) {
    const fields = input as Record<string, unknown> | undefined;
    const title = info?.title ?? (typeof fields?.title === 'string' ? fields.title : '');
    const query = fields?.query ?? fields?.pattern;
    let summary = `${failed ? '未能' : ''}${action}${title ? `《${title}》` : ''}`;
    if (typeof query === 'string') summary += `“${query}”`;
    const metrics: string[] = [];
    if (info?.wordCount !== undefined) metrics.push(`${info.wordCount.toLocaleString('en-US')} 字`);
    if (info?.count !== undefined) metrics.push(`返回 ${info.count} 条`);
    if (metrics.length) {
      summary += `${summary.endsWith('》') || summary.endsWith('”') ? ' ' : ' · '}${metrics.join(' · ')}`;
    }
    const description =
      info?.description ?? (name === 'work_record_write' && typeof fields?.text === 'string' ? fields.text : '');
    if (description) summary += `：${description}`;
    if (failed && info?.error) summary += `：${info.error}`;
    return summary;
  }
  const pending = verbs[name]?.[1] ?? action;
  const verb = failed ? `未能${pending}` : done ? (verbs[name]?.[0] ?? action) : pending;
  const object = target(input);
  return object ? `${verb} ${object}` : verb;
}

/** 连续工具按作者可读的动作计数，工具的参数与结果留在下一层。 */
export function summarizeTools(tools: readonly ToolActivity[]): string {
  const counts = new Map<string, { count: number; unit: string }>();
  for (const tool of tools.flatMap(activity => (activity.children?.length ? activity.children : [activity]))) {
    const [action, unit] = toolAction(tool.name, tool.input ?? tool.preview, tool.info);
    const previous = counts.get(action);
    counts.set(action, { count: (previous?.count ?? 0) + 1, unit });
  }
  return [...counts].map(([action, { count, unit }]) => `${action} ${count} ${unit}`).join(' · ');
}

/** 展开时保留脚本入口，子调用按原生记录顺序列在其后。 */
export function toolRows(tools: readonly ToolActivity[]): ToolActivity[] {
  return tools.flatMap(tool => [tool, ...(tool.children ?? [])]);
}

export function hasRunningTools(tools: readonly ToolActivity[]): boolean {
  return tools.some(
    tool =>
      (!tool.result && !tool.incomplete) || (tool.children?.some(child => !child.result && !child.incomplete) ?? false)
  );
}

export function extractEntryTarget(name: string, input: unknown, info?: ToolResultInfo): ToolEntryTarget | undefined {
  if (!name.startsWith('work_')) return undefined;
  const fields = input && typeof input === 'object' ? (input as Record<string, unknown>) : undefined;
  const entryId = info?.entryId ?? (typeof fields?.entryId === 'string' ? fields.entryId : '');
  const title = info?.title ?? (typeof fields?.title === 'string' ? fields.title : '');
  if (!entryId || !title) return undefined;
  const workId = info?.workId ?? (typeof fields?.workId === 'string' ? fields.workId : undefined);
  return { ...(workId && { workId }), entryId, title };
}

function nestedActivities(parent: ToolActivity, calls: NestedToolView[]): ToolActivity[] {
  return calls.map(call => {
    const info = { ...call.info, error: call.info?.error ?? call.error };
    const failed = call.status === 'error';
    const rawInput = call.input ?? call.preview;
    return {
      kind: 'tool',
      id: call.id,
      key: `${parent.key}:${call.id}`,
      name: call.name,
      input: rawInput,
      preview: call.preview,
      info,
      nested: true,
      incomplete: call.status === 'unfinished',
      summary: describeTool(call.name, rawInput, call.status === 'ok', failed, info),
      entryTarget: extractEntryTarget(call.name, rawInput, info),
      result:
        call.status === 'running'
          ? undefined
          : {
              text: call.error ?? '',
              error: failed
            }
    };
  });
}

/**
 * 把宿主消息整理成阅读顺序：作者消息、助手回复，工具结果并回发起它的工具行。
 * 同一段工具活动跨原生回合合并，新的助手正文、作者消息和通知划分边界。
 */
export function buildTranscript(messages: ChatMessage[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const pending: ToolActivity[] = [];
  let currentTurnUser: RetryTarget | undefined;
  function appendAssistant(item: Extract<TranscriptItem, { kind: 'assistant' }>) {
    const previous = items.at(-1);
    if (!item.text && previous?.kind === 'assistant' && previous.tools.length) {
      previous.tools.push(...item.tools);
      if (item.thinking) {
        if (previous.thinking) previous.thinking.text += `\n\n${item.thinking.text}`;
        else previous.thinking = item.thinking;
      }
      previous.error ||= item.error;
      if (item.errorMessage) previous.errorMessage = item.errorMessage;
      if (item.aborted) previous.aborted = true;
      previous.index = item.index;
    } else {
      if (previous?.kind === 'assistant') delete previous.retryTarget;
      item.retryTarget = currentTurnUser;
      items.push(item);
    }
  }
  messages.forEach((message, index) => {
    const key = String(index);
    if (message.role === 'user') {
      currentTurnUser = message.entryId
        ? {
            entryId: message.entryId,
            text: formatSkillPrompt(message.text, message.skill),
            editorContext: message.editorContext
          }
        : undefined;
      items.push({
        kind: 'user',
        key,
        entryId: message.entryId,
        text: message.text,
        compacted: message.compacted,
        editorContext: message.editorContext,
        ...(message.skill && { skill: message.skill }),
        branch: message.branch
      });
      return;
    }
    if (message.role === 'reviewResults') {
      items.push({ kind: 'notice', key, text: message.text, outcomes: message.outcomes! });
      return;
    }
    if (message.role === 'compactionSummary') {
      items.push({ kind: 'summary', key, text: message.text });
      return;
    }
    if (message.role === 'toolResult') {
      const at = pending.findIndex(tool => tool.id === message.toolCallId);
      const tool = at === -1 ? undefined : pending.splice(at, 1)[0];
      if (tool) {
        tool.result = { text: message.text, error: message.error === true };
        tool.info = { ...tool.info, ...message.toolInfo };
        tool.summary = describeTool(tool.name, tool.input, true, message.error === true, tool.info);
        tool.entryTarget = extractEntryTarget(tool.name, tool.input, tool.info);
        if (message.nestedTools) {
          tool.incomplete = message.nestedToolsComplete === false;
          tool.children = nestedActivities(tool, message.nestedTools);
        }
        return;
      }
      const orphanName = message.toolName ?? '工具';
      const orphan: ToolActivity = {
        kind: 'tool',
        id: message.toolCallId!,
        key,
        name: orphanName,
        summary: describeTool(orphanName, undefined, true, message.error === true, message.toolInfo),
        entryTarget: extractEntryTarget(orphanName, undefined, message.toolInfo),
        input: undefined,
        info: message.toolInfo,
        result: { text: message.text, error: message.error === true }
      };
      appendAssistant({
        kind: 'assistant',
        key,
        index,
        text: '',
        error: false,
        tools: [orphan],
        compacted: message.compacted
      });
      return;
    }
    const tools = message.tools.map<ToolActivity>(tool => {
      const activity: ToolActivity = {
        kind: 'tool',
        id: tool.id,
        key: `${key}:${tool.id}`,
        name: tool.name,
        summary: describeTool(tool.name, tool.input, false, false, tool.info),
        entryTarget: extractEntryTarget(tool.name, tool.input, tool.info),
        input: tool.input,
        info: tool.info
      };
      if (tool.nestedTools) activity.children = nestedActivities(activity, tool.nestedTools);
      return activity;
    });
    pending.push(...tools);
    appendAssistant({
      kind: 'assistant',
      key,
      index,
      thinking: message.thinking ? { kind: 'thinking', key: `${key}:thinking`, text: message.thinking } : undefined,
      text: message.text,
      error: message.error === true,
      errorMessage: message.errorMessage,
      aborted: message.aborted,
      tools,
      compacted: message.compacted
    });
  });
  return items;
}
