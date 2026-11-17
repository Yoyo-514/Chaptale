import type { RpcClient, RpcCommand, RpcPacket, RpcReply, RpcRequest } from '@chaptale/contracts';
import type { ImportWorkPackageInput, Work, WorkReplacement } from '@chaptale/creation/contracts';

import type {
  ChatMessage,
  EditorContext,
  HistoryItem,
  NestedToolView,
  QueuedDelivery,
  QueuedMessage,
  RetryState,
  SessionNoticeLevel,
  SessionUsage,
  SessionView
} from './conversation.ts';
import type { AgentInstructions, EditMode, NamedInstructions } from './instructions.ts';
import type { ManagedMcpSnapshot, McpConfigScope, McpSelectableExposure } from './mcp.ts';
import type { DiscoveredModel, ModelChoice, ModelDiscovery, ModelRef, ProviderSave, ProviderView } from './models.ts';
import type { Approval, ApprovalScope, McpApprovalRememberTarget, ToolPermission } from './permissions.ts';
import type { ManagedSkillView, ManagedSkillsSnapshot, SessionSkillItem, SkillScope } from './skills.ts';

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

export interface HostState {
  cursor: number;
  settings: HostSettings;
  models: ModelChoice[];
  sessions: SessionView[];
  approvals: Approval[];
  tools: string[];
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
  dismissError: { input: { id: string }; output: void };
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
  approve: {
    input: { id: string; allow: boolean; scope?: ApprovalScope; mcpTarget?: McpApprovalRememberTarget };
    output: void;
  };
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
  /** 扫描全局与可选作品目录下的 Skills 及其启停状态与格式告警。 */
  listSkills: { input: { workId: string | null }; output: ManagedSkillsSnapshot };
  /** 切换全局或作品级指定技能的启停状态。 */
  setSkillEnabled: {
    input: { scope: SkillScope; workId: string | null; name: string; enabled: boolean };
    output: ManagedSkillsSnapshot;
  };
  /** 在全局或作品技能目录下新建标准 SKILL.md 模板。 */
  createSkill: {
    input: {
      scope: SkillScope;
      workId: string | null;
      name: string;
      description: string;
      disableModelInvocation?: boolean;
    };
    output: { skill: ManagedSkillView; snapshot: ManagedSkillsSnapshot };
  };
  /** 导入外部技能文件夹或单个 .md 文件到全局或作品技能目录。 */
  importSkill: {
    input: { scope: SkillScope; workId: string | null; sourcePath: string };
    output: { imported: string[]; snapshot: ManagedSkillsSnapshot };
  };
  /** 移除指定技能并暂存待回收目录，files 由平台移入系统回收站。 */
  removeSkill: {
    input: { scope: SkillScope; workId: string | null; filePath: string };
    output: { files: string[]; snapshot: ManagedSkillsSnapshot };
  };
  /** 查询指定打开会话当前可用的已启用技能（含仅手动调用项），供输入框 `/` 补全。 */
  sessionSkills: { input: { id: string }; output: SessionSkillItem[] };
  /** 读取全局与可选作品级 mcp.json 文本、校验错误及当前共享连接状态。 */
  getMcpState: { input: { workId: string | null }; output: ManagedMcpSnapshot };
  /** 校验并保存全局或作品级 mcp.json 文本，立即刷新受影响连接。 */
  saveMcpConfig: {
    input: { scope: McpConfigScope; workId: string | null; json: string };
    output: ManagedMcpSnapshot;
  };
  /** 在全局或作品级 mcp.json 中快速切换服务启停或三档暴露方式。 */
  patchMcpServer: {
    input: {
      targetScope: McpConfigScope;
      workId: string | null;
      name: string;
      enabled?: boolean;
      exposure?: McpSelectableExposure;
    };
    output: ManagedMcpSnapshot;
  };
  /** 立即断开并重新连接指定服务。 */
  reconnectMcpServer: { input: { workId: string | null; name: string }; output: ManagedMcpSnapshot };
  /** 发起远程 MCP 的 OAuth 2.1 登录（可刷新既有令牌时直接完成，否则返回浏览器授权地址）。 */
  startMcpSignIn: {
    input: { workId: string | null; name: string };
    output: { authorized: boolean; authorizationUrl?: string; snapshot: ManagedMcpSnapshot };
  };
  /** 当浏览器无法回跳本机端口时，提交地址栏重定向 URL 完成 OAuth 换牌。 */
  submitMcpRedirectUrl: {
    input: { workId: string | null; name: string; redirectUrl: string };
    output: ManagedMcpSnapshot;
  };
  /** 取消正在等待回调的 OAuth 登录。 */
  cancelMcpSignIn: { input: { workId: string | null; name: string }; output: ManagedMcpSnapshot };
  /** 清除指定服务已保存的 OAuth 凭据并断开连接。 */
  signOutMcpServer: { input: { workId: string | null; name: string }; output: ManagedMcpSnapshot };
}

export type HostCommand = RpcCommand<HostCommands>;

export type HostChange =
  | { kind: 'session'; session: SessionView }
  | { kind: 'message'; id: string; index: number; message: ChatMessage }
  | { kind: 'delta'; id: string; index: number; field: 'text' | 'thinking'; text: string }
  | { kind: 'tool'; id: string; index: number; parentCallId: string; call: NestedToolView }
  | { kind: 'queue'; id: string; queued: QueuedMessage[] }
  | {
      kind: 'running';
      id: string;
      running: boolean;
      compacting: boolean;
      error?: string;
      noticeLevel?: SessionNoticeLevel;
      retrying?: RetryState;
    }
  | { kind: 'usage'; id: string; usage: SessionUsage }
  | { kind: 'closed'; id: string }
  | { kind: 'approval'; approval: Approval }
  | { kind: 'approval-closed'; id: string }
  | { kind: 'models'; models: ModelChoice[] }
  | { kind: 'settings'; settings: HostSettings }
  | { kind: 'mcp' };

export type HostEvent = HostChange & { cursor: number };

export type HostRequest = RpcRequest<HostCommands>;

export type HostReply = RpcReply;

export type HostPacket = RpcPacket<HostEvent>;

export type AgentClient = RpcClient<HostCommands, HostEvent>;
