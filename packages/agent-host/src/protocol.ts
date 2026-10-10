/**
 * 原生 JSONL 中保存会话提示词的自定义记录类型。
 * 这是持久化格式标识，属于存储契约；宿主与历史恢复必须使用同一常量。
 */
export const promptEntryType = 'chaptale-system-prompt';

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
  systemPrompt: string;
  messages: ChatMessage[];
  error?: string;
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
  defaultSystemPrompt: string;
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
  create: { input: { model: ModelRef }; output: string };
  open: { input: { file: string; cwd: string }; output: string };
  prompt: { input: { id: string; text: string }; output: void };
  cancel: { input: { id: string }; output: void };
  close: { input: { id: string }; output: void };
  model: { input: { id: string; model: ModelRef }; output: void };
  approve: { input: { id: string; allow: boolean }; output: void };
  history: { input: undefined; output: HistoryItem[] };
  configure: { input: ProviderInput; output: void };
  systemPrompt: { input: { id: string; text: string }; output: void };
  defaultSystemPrompt: { input: { text: string }; output: void };
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
  | { kind: 'default-prompt'; text: string };
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
