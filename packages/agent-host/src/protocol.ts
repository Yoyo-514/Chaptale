/**
 * 原生 JSONL 中保存会话指令与修改模式的自定义记录类型。
 * 这是持久化格式标识，属于存储契约；宿主与历史恢复必须使用同一常量。
 */
export const instructionsEntryType = 'chaptale-agent-instructions';
export const modeEntryType = 'chaptale-edit-mode';

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
/** 本机应用设置；只决定新会话的初始指令与模式。 */
export interface HostSettings {
  defaultInstructions: AgentInstructions;
  namedInstructions: NamedInstructions[];
  defaultMode: EditMode;
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
export interface ProviderInput {
  provider: string;
  baseUrl: string;
  api: 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai';
  modelId: string;
  modelName: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  apiKey?: string;
}
export type ProviderSummary = Omit<ProviderInput, 'apiKey'>;
export interface ChatMessage {
  role: string;
  text: string;
  thinking: string;
  tools: { id: string; name: string; input: unknown }[];
  toolName?: string;
  error?: boolean;
}
export interface SessionView {
  id: string;
  file: string;
  cwd: string;
  model?: ModelRef;
  running: boolean;
  /** 只读历史缺少记录时为空列表。 */
  instructions: AgentInstructions;
  mode?: EditMode;
  messages: ChatMessage[];
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
}
export interface HostState {
  cursor: number;
  settings: HostSettings;
  models: ModelChoice[];
  sessions: SessionView[];
  approvals: Approval[];
  cwd: string;
  tools: string[];
}
export interface HistoryItem {
  id: string;
  file: string;
  cwd: string;
  title: string;
  modified: string;
}
export interface HostCommands {
  state: { input: undefined; output: HostState };
  /** instructions 为命名指令名称；省略时复制全局默认指令。 */
  create: { input: { model: ModelRef; instructions?: string }; output: string };
  open: { input: { file: string; cwd: string }; output: string };
  prompt: { input: { id: string; text: string }; output: void };
  cancel: { input: { id: string }; output: void };
  close: { input: { id: string }; output: void };
  model: { input: { id: string; model: ModelRef }; output: void };
  approve: { input: { id: string; allow: boolean }; output: void };
  history: { input: undefined; output: HistoryItem[] };
  configure: { input: ProviderInput; output: void };
  instructions: { input: { id: string; entries: AgentInstructions }; output: void };
  mode: { input: { id: string; mode: EditMode }; output: void };
  defaultInstructions: { input: { entries: AgentInstructions }; output: void };
  /** 按名称保存；同名时覆盖，不影响已有会话。 */
  namedInstructions: { input: NamedInstructions; output: void };
  deleteNamedInstructions: { input: { name: string }; output: void };
  defaultMode: { input: { mode: EditMode }; output: void };
}
export type HostCommand = {
  [K in keyof HostCommands]: { method: K; input: HostCommands[K]['input'] };
}[keyof HostCommands];
export type HostChange =
  | { kind: 'session'; session: SessionView }
  | { kind: 'message'; id: string; index: number; message: ChatMessage }
  | { kind: 'delta'; id: string; index: number; field: 'text' | 'thinking'; text: string }
  | { kind: 'running'; id: string; running: boolean; error?: string }
  | { kind: 'closed'; id: string }
  | { kind: 'approval'; approval: Approval }
  | { kind: 'approval-closed'; id: string }
  | { kind: 'models'; models: ModelChoice[] }
  | { kind: 'settings'; settings: HostSettings };
export type HostEvent = HostChange & { cursor: number };
export interface HostRequest {
  id: string;
  command: HostCommand;
}
export type HostReply = { id: string; ok: true; value: unknown } | { id: string; ok: false; error: string };
export type HostPacket = { type: 'event'; event: HostEvent } | { type: 'reply'; reply: HostReply };
export interface AgentClient {
  request<K extends keyof HostCommands>(method: K, input: HostCommands[K]['input']): Promise<HostCommands[K]['output']>;
  subscribe(listener: (event: HostEvent) => void): () => void;
}
