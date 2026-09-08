import { WorkspaceRelativePathValidator, type AgentRunRecord } from '@chaptale/shared';

export const RUN_STATUS_LABELS = { success: '已完成', failed: '失败', cancelled: '已取消', timeout: '超时' };
export const RUN_PERSONA_LABELS: Record<string, string> = {
  draft: '候选起草',
  rewriter: '候选修订',
  'memory-distiller': '记忆整理',
  'continuity-reviewer': '连贯性审查',
  'character-reviewer': '人物审查',
  'style-reviewer': '文风审查'
};
export const runTitle = (record: AgentRunRecord) =>
  record.inputDigest.brief?.trim() ||
  record.inputDigest.files?.join('、') ||
  RUN_PERSONA_LABELS[record.personaId] ||
  record.personaId;
export function runReference(reference: string) {
  const match = /^(.*)#([a-f0-9]{64})$/.exec(reference);
  const sourcePath = match?.[1] ?? reference;
  return {
    sourcePath,
    hash: match?.[2],
    canOpen:
      WorkspaceRelativePathValidator.Check(sourcePath) &&
      !sourcePath.startsWith('.chaptale/') &&
      /\.(md|markdown|txt)$/i.test(sourcePath)
  };
}
export function verifyRunOutput(record: AgentRunRecord, output: { runId: string; contentHash?: string } | null) {
  if (!output) throw new Error('运行输出不存在或不可读');
  if (output.runId !== record.id) throw new Error('输出归属与运行记录不匹配');
  if (record.outputHash && output.contentHash !== record.outputHash)
    throw new Error('输出内容已变化，未展示为原始产物');
}
