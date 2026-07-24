/** 提议三型：新建资产 / 更新资产 / 归档资产（改 status，不删除文件）。 */
export type MemoryProposalType = 'create' | 'update' | 'archive';

/** pending 提议的结构化视图（`.chaptale/memory/pending/<id>.md` 的解析结果）。 */
export type MemoryPendingProposal = {
  id: string;
  proposalType: MemoryProposalType;
  title: string;
  /** 提议理由：为什么该改（模型给出，供作者判断）。 */
  reason: string;
  /** 目标文件（workspace 相对路径）；create 为建议落点，update/archive 为现有文件。 */
  targetPath: string;
  /** update/archive 提议创建时目标文件的内容指纹；接受时复核防并发覆盖。 */
  contentHash?: string;
  relatedTo?: string[];
  /** 追溯来源（session:<id> 等）。 */
  source: string;
  createdAt: string;
  /** create/update 型的完整新内容；archive 型为空。 */
  content: string;
};

/** 解析失败的 pending 文件诊断：跳过坏文件但保留线索。 */
export type MemoryPendingDiagnostic = {
  filePath: string;
  message: string;
};

export type MemoryPendingListResult = {
  proposals: MemoryPendingProposal[];
  diagnostics: MemoryPendingDiagnostic[];
};

export type MemoryPendingAction = 'accept' | 'reject';

/** 当前会话上下文水位；compaction 后尚无新 usage 时 tokens/percent 为 null。 */
export type MemoryContextPressureStatus = {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  thresholdPercent: number;
  shouldPrompt: boolean;
};

/** 压缩结果；summaryRef 必然存在，因为 memory 检查点落盘是 compaction 前置条件。 */
export type MemoryCompactionResult = {
  sessionId: string;
  tokensBefore: number;
  estimatedTokensAfter?: number;
  summaryRef: string;
};

/**
 * 提议处理结果：
 * - applied：接受且已写盘；rejected：拒绝并归档留痕；
 * - conflict：目标已被作者修改（contentHash 不符）或落点被占用，提议保留待作者定夺；
 * - missing：提议不存在（已被处理或文件被移走）。
 */
export type MemoryPendingResolveResult = {
  id: string;
  status: 'applied' | 'rejected' | 'conflict' | 'missing';
  message?: string;
};
