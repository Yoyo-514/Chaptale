import type { RpcClient, RpcCommand, RpcPacket, RpcReply, RpcRequest } from '@chaptale/contracts';
import type { ImportWorkPackageInput, Work, WorkReplacement } from '@chaptale/creation/contracts';

/**
 * 原生 JSONL 中保存会话指令与修改模式的自定义记录类型。
 * 这是持久化格式标识，属于存储契约；宿主与历史恢复必须使用同一常量。
 */
export const instructionsEntryType = 'chaptale-agent-instructions';
export const modeEntryType = 'chaptale-edit-mode';
export const branchCursorEntryType = 'chaptale-branch';
export const reviewResultsMessageType = 'chaptale-review-results';

/** 讨论禁止写入作品；审阅生成待接受修改；直接修改保存正式修订。 */
export const editModes = ['discuss', 'review', 'direct'] as const;
export type EditMode = (typeof editModes)[number];

/** 一套 Agent 指令由有序条目组成；启用的条目按顺序放在请求最前面。 */
export interface InstructionEntry {
  name: string;
  role: 'system' | 'user' | 'assistant';
  text: string;
  enabled: boolean;
}
export type AgentInstructions = InstructionEntry[];
export interface NamedInstructions {
  name: string;
  entries: AgentInstructions;
}
export type ApprovalScope = 'once' | 'session' | 'work';
export type ToolPermissionScope = { kind: 'session'; sessionId: string } | { kind: 'work'; workId: string };
export interface ToolPermission {
  id: string;
  scope: ToolPermissionScope;
  capability: 'fs_read';
  path: string;
  pathKind: 'directory' | 'file';
}
export interface ApprovalRememberOption {
  capability: 'fs_read';
  path: string;
  pathKind: 'directory' | 'file';
  /** 会话归属有效作品时为 true，允许保存为本机作品级授权。 */
  allowWork: boolean;
}
/** 本机应用设置；不进入作品备份。 */
export interface HostSettings {
  defaultInstructions: AgentInstructions;
  namedInstructions: NamedInstructions[];
  defaultMode: EditMode;
  /** 作者最近一次选择的模型（新建会话或会话中切换），新会话沿用；可能已从配置中删除。 */
  lastModel: ModelRef | null;
  /** 作者主动记住的会话级与作品级本机工具放行规则。 */
  toolPermissions: ToolPermission[];
}
/** 只读历史的原因；lines 是无法解析的 JSONL 行号（从 1 开始）。 */
export interface ReadonlyHistory {
  reason: 'incomplete' | 'damaged';
  message: string;
  lines: number[];
}

/** 新 Agent 界面的传输契约；不携带运行时对象或供应商凭据快照。 */
export interface ModelRef {
  provider: string;
  id: string;
}
export interface ModelChoice extends ModelRef {
  name: string;
}
/** models.json 中的模型条目；界面未展示的原生字段原样保留。 */
export interface NativeModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: ('text' | 'image')[];
  contextWindow?: number;
  maxTokens?: number;
  [field: string]: unknown;
}
/** models.json 中的供应商条目，不含密钥。 */
export interface NativeProvider {
  baseUrl?: string;
  api?: string;
  headers?: Record<string, string>;
  models?: NativeModel[];
  [field: string]: unknown;
}
export interface ProviderView {
  id: string;
  config: NativeProvider;
  hasApiKey: boolean;
}
/** 整体替换一个供应商；apiKey 省略时保留已保存的密钥。 */
export interface ProviderSave {
  id: string;
  config: NativeProvider;
  apiKey?: string;
}
/** 按表单中的连接拉取模型列表；apiKey 省略时使用 id 对应供应商已保存的凭据。 */
export interface ModelDiscovery {
  id?: string;
  baseUrl: string;
  api: string;
  headers?: Record<string, string>;
  apiKey?: string;
}
export interface DiscoveredModel {
  id: string;
  name: string;
}
/** 发送消息时附带的当前打开标签定位与可选框选原文；正文由 Agent 按需调用 work_read 读取。 */
export interface EditorContext {
  workId: string;
  entryId: string;
  title: string;
  section: 'manuscript' | 'resource';
  selection?: string;
}

/** 工具结果中用于阅读摘要的元数据，正文只通过原始结果传输一次。 */
export interface ToolResultInfo {
  workId?: string;
  entryId?: string;
  title?: string;
  section?: 'manuscript' | 'resource';
  wordCount?: number;
  count?: number;
  description?: string;
  error?: string;
}
/** pi 原生保存的有界子调用记录；详细输出仍属于外层脚本。 */
export interface NestedToolView {
  id: string;
  name: string;
  input?: unknown;
  /** 运行中的摘要字段；原始参数沿用完成后的 SDK 有界记录。 */
  preview?: Record<string, unknown>;
  status: 'running' | 'ok' | 'error' | 'unfinished';
  error?: string;
  info?: ToolResultInfo;
}
export interface ToolCallView {
  id: string;
  name: string;
  input: unknown;
  info?: ToolResultInfo;
  nestedTools?: NestedToolView[];
}
/** 会话树分叉点在当前分支消息上的切换信息（1-based）。 */
export interface MessageBranch {
  index: number;
  total: number;
  prevLeafId?: string;
  nextLeafId?: string;
}
export interface ChatMessage {
  /** 原生 JSONL 条目 ID；流式尚未落盘或损坏行恢复时可能为空。 */
  entryId?: string;
  /** pi 消息角色；`compactionSummary` 为会话压缩总结，`reviewResults` 为作者的逐处处理结果，text 是显示文字。 */
  role: string;
  text: string;
  thinking: string;
  tools: ToolCallView[];
  toolName?: string;
  /** toolResult 对应的原生调用身份，同名调用按此关联。 */
  toolCallId?: string;
  toolInfo?: ToolResultInfo;
  nestedTools?: NestedToolView[];
  nestedToolsComplete?: boolean;
  /** 作者消息关联的编辑上下文（仅在有选区时在气泡上方显示引用块）。 */
  editorContext?: EditorContext;
  /** 该条消息所在分叉点的兄弟分支信息。 */
  branch?: MessageBranch;
  error?: boolean;
  /** 已被压缩总结代替、不再发送给模型的消息，界面仍可查看。 */
  compacted?: boolean;
  /** reviewResults 的逐条处理结果，如“《第一章》已拒绝”。 */
  outcomes?: { id: string; text: string }[];
}
/** pi 记录的累计用量；供应商未报告的项目可能记为 0。 */
export interface SessionUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** 上下文为估算值；压缩后尚无有效回复时 tokens、percent 为 null。 */
  context?: { tokens: number | null; contextWindow: number; percent: number | null };
}
/** 运行中发出的消息排队方式：steer 在当前步骤后立即插话，followUp 等整轮收尾后继续处理。 */
export type QueuedDelivery = 'steer' | 'followUp';
export interface QueuedMessage {
  delivery: QueuedDelivery;
  text: string;
  editorContext?: EditorContext;
}
export interface SessionView {
  /** 当前打开实例的操作句柄；只读副本具有独立句柄。 */
  id: string;
  /** pi 原生会话身份；历史头损坏时为空。 */
  sessionId: string | null;
  /** 用户设置的会话名称，保存在 pi 原生 session_info 记录中。 */
  name?: string;
  file: string;
  /** 会话归属的作品，由历史文件所在目录确定；未归属为 null。 */
  workId: string | null;
  model?: ModelRef;
  running: boolean;
  /** 手动或自动压缩期间为 true；running 包含压缩占用。 */
  compacting: boolean;
  /** 只读历史缺少记录时为空列表。 */
  instructions: AgentInstructions;
  mode?: EditMode;
  messages: ChatMessage[];
  /** 已入队但尚未被模型消费的插话与稍后处理消息。 */
  queued?: QueuedMessage[];
  /** 可继续的会话从原生 SDK 读取；只读历史不计算用量。 */
  usage?: SessionUsage;
  error?: string;
  /** 存在时会话只能查看，不能发送、切换模型或修改指令与模式。 */
  readonly?: ReadonlyHistory;
}
export interface Approval {
  id: string;
  sessionId: string;
  toolName: string;
  input: unknown;
  cwd: string;
  /** 可记住的放行范围；路径无法静态解析或直接读取盘符根／用户主目录时为空（仅开放单次允许）。 */
  remember?: ApprovalRememberOption;
}
export interface HostState {
  cursor: number;
  settings: HostSettings;
  models: ModelChoice[];
  sessions: SessionView[];
  approvals: Approval[];
  tools: string[];
}
export interface HistoryItem {
  id: string;
  file: string;
  /** 历史文件所在目录对应的作品；未归属为 null。 */
  workId: string | null;
  title: string;
  modified: string;
}
export interface HostCommands {
  state: { input: undefined; output: HostState };
  /**
   * instructions 省略时复制全局默认指令。workId 非空时会话归入该作品，以作品文件目录为工作目录；
   * 为 null 时使用应用的空工作目录。
   */
  create: { input: { model: ModelRef; instructions?: string; workId: string | null }; output: string };
  /** 工作目录按历史文件所在目录对应的作品确定。 */
  open: { input: { file: string }; output: string };
  /**
   * 把未归属会话的历史文件移入作品目录：会话在运行则拒绝；已打开的会话先关闭，移动后重新打开并返回其句柄，
   * 未打开时返回 null。尚未写盘的新会话不能归入。
   */
  assignSession: { input: { sessionId: string; workId: string }; output: string | null };
  prompt: {
    input: { id: string; text: string; editorContext?: EditorContext; delivery?: QueuedDelivery };
    output: void;
  };
  /** 撤回一条尚未被模型读取的排队消息；若已被模型消费则返回 null。 */
  dequeue: { input: { id: string; delivery: QueuedDelivery; index: number }; output: QueuedMessage | null };
  /** 基于目标作者消息在原生会话树原地分叉并重发；有未处理待审修改时需 discardPending 确认撤回。 */
  editMessage: {
    input: { id: string; entryId: string; text: string; editorContext?: EditorContext; discardPending?: boolean };
    output: void;
  };
  /** 切换到原生会话树的另一分支叶子；有未处理待审修改时需 discardPending 确认撤回。 */
  switchBranch: { input: { id: string; leafId: string; discardPending?: boolean }; output: void };
  cancel: { input: { id: string }; output: void };
  compact: { input: { id: string }; output: void };
  close: { input: { id: string }; output: void };
  /**
   * 删除会话：任一会话在运行则整体拒绝；先拒绝这些会话的全部待审修改并清除查看位置，再关闭已打开的会话。
   * 返回待删除的历史文件，由平台移入回收站；尚未写盘的新会话只关闭。
   */
  deleteSessions: { input: { sessionIds: string[] }; output: { files: string[] } };
  /** 把作品移入作品库回收站：属于它的会话在运行则拒绝，已打开的会话先关闭；会话归属保留。 */
  trashWork: { input: { commandId: string; workId: string }; output: Work };
  /** 永久删除回收站中的作品；files 含作品目录与其会话目录，由平台移入回收站。 */
  purgeWork: { input: { commandId: string; workId: string }; output: { files: string[] } };
  /** 导入作品包；覆盖已有作品时属于它的会话在运行则拒绝，已打开的会话随后关闭。files 由平台移入回收站。 */
  importWorkPackage: { input: ImportWorkPackageInput; output: WorkReplacement };
  /** 换回导入前快照，会话规则同覆盖导入。files 由平台移入回收站。 */
  restoreWorkSnapshot: { input: { commandId: string; workId: string }; output: WorkReplacement };
  model: { input: { id: string; model: ModelRef }; output: void };
  approve: { input: { id: string; allow: boolean; scope?: ApprovalScope }; output: void };
  revokeToolPermission: { input: { id: string }; output: void };
  /** 只读历史不能重命名。 */
  rename: { input: { id: string; name: string }; output: void };
  /** 枚举宿主管理目录中的全部原生历史，业务归属由应用层筛选。 */
  history: { input: undefined; output: HistoryItem[] };
  providers: { input: undefined; output: ProviderView[] };
  /** 正在生成内容的模型不能被移除。 */
  saveProvider: { input: ProviderSave; output: void };
  deleteProvider: { input: { id: string }; output: void };
  discoverModels: { input: ModelDiscovery; output: DiscoveredModel[] };
  instructions: { input: { id: string; entries: AgentInstructions }; output: void };
  mode: { input: { id: string; mode: EditMode }; output: void };
  defaultInstructions: { input: { entries: AgentInstructions }; output: void };
  /** 按名称保存；同名时覆盖，不影响已有会话。 */
  namedInstructions: { input: NamedInstructions; output: void };
  deleteNamedInstructions: { input: { name: string }; output: void };
  defaultMode: { input: { mode: EditMode }; output: void };
}
export type HostCommand = RpcCommand<HostCommands>;
export type HostChange =
  | { kind: 'session'; session: SessionView }
  | { kind: 'message'; id: string; index: number; message: ChatMessage }
  | { kind: 'delta'; id: string; index: number; field: 'text' | 'thinking'; text: string }
  | { kind: 'tool'; id: string; index: number; parentCallId: string; call: NestedToolView }
  | { kind: 'queue'; id: string; queued: QueuedMessage[] }
  | { kind: 'running'; id: string; running: boolean; compacting: boolean; error?: string }
  | { kind: 'usage'; id: string; usage: SessionUsage }
  | { kind: 'closed'; id: string }
  | { kind: 'approval'; approval: Approval }
  | { kind: 'approval-closed'; id: string }
  | { kind: 'models'; models: ModelChoice[] }
  | { kind: 'settings'; settings: HostSettings };
export type HostEvent = HostChange & { cursor: number };
export type HostRequest = RpcRequest<HostCommands>;
export type HostReply = RpcReply;
export type HostPacket = RpcPacket<HostEvent>;
export type AgentClient = RpcClient<HostCommands, HostEvent>;
