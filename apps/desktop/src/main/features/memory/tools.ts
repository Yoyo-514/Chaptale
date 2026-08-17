import { writeFile } from 'atomically';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Type } from 'typebox';

import { resolveWorkspaceMemoryPaths } from '../../core/memory-layout/paths';
import type { ToolDefinition } from '../../core/tool-protocol/definition';
import type { MemoryPendingStore } from './pending/store';

export type MemoryToolContext = {
  resolveCwd: () => Promise<string> | string;
  /** 返回当前会话 id；未就绪时返回 null，工具报错而非写入无来源的记录。 */
  getSessionId: () => string | null;
};

const memorySaveParameters = Type.Object(
  {
    title: Type.String({ minLength: 1, description: '笔记标题，一篇只记一件事（如"观察：林晚似乎怕水"）' }),
    content: Type.String({ minLength: 1, description: '正文：结论与依据，一两段写完；引用用 [[资产名]] 或文件路径' }),
    relatedTo: Type.Optional(Type.Array(Type.String(), { description: '双链到相关资产（如 ["[[林晚]]"]）' }))
  },
  { additionalProperties: false }
);

/**
 * memory_save：把观察/推断落为笔记（`.chaptale/memory/notes/<标题>.md`）。
 *
 * 写入范围被锁死在 notes 目录内（标题经文件名净化，无路径穿越面），
 * notes 是设计上的 agent 直写观察区、不可触达资产——与 todo_write 同级的
 * 应用管理区写入，因此分级 readonly，"记一下"不打断对话。
 */
export function createMemorySaveTool(context: MemoryToolContext): ToolDefinition<typeof memorySaveParameters> {
  return {
    name: 'memory_save',
    riskLevel: 'readonly',
    label: '记笔记',
    description:
      '把值得跨会话留存的观察、推断或待确认线索记为笔记（落 .chaptale/memory/notes/）。' +
      '一篇只记一件事；不要记一次性信息、可从正文推导的内容或敏感配置。',
    parameters: memorySaveParameters,
    async execute(params) {
      const sessionId = context.getSessionId();

      if (!sessionId) {
        throw new Error('当前会话尚未就绪，无法写入笔记');
      }

      const cwd = await context.resolveCwd();
      const notesDir = resolveWorkspaceMemoryPaths(cwd).notesDir;
      await fs.mkdir(notesDir, { recursive: true });

      const fileName = await uniqueNoteFileName(notesDir, sanitizeFileName(params.title));
      const relativePath = ['.chaptale', 'memory', 'notes', fileName].join('/');

      const frontmatter = [
        '---',
        'kind: note',
        `title: ${JSON.stringify(params.title)}`,
        `source: ${JSON.stringify(`session:${sessionId}`)}`,
        ...(params.relatedTo?.length
          ? [`relatedTo: [${params.relatedTo.map(item => JSON.stringify(item)).join(', ')}]`]
          : []),
        `createdAt: ${JSON.stringify(new Date().toISOString())}`,
        '---',
        ''
      ].join('\n');

      await writeFile(path.join(notesDir, fileName), `${frontmatter}${params.content.trimEnd()}\n`, 'utf8');

      return { text: `笔记已保存：${relativePath}`, details: { path: relativePath } };
    }
  };
}

const memoryProposeParameters = Type.Object(
  {
    proposalType: Type.Union([Type.Literal('create'), Type.Literal('update'), Type.Literal('archive')], {
      description: 'create=新建资产文件；update=整体更新现有文件；archive=归档（标记 status: archived，不删除）'
    }),
    title: Type.String({ minLength: 1, description: '提议标题（如"更新林晚的伤势状态"）' }),
    reason: Type.String({ minLength: 1, description: '提议理由：为什么该改，给作者判断依据' }),
    targetPath: Type.String({
      minLength: 1,
      description: '目标文件的作品内相对路径；create 为建议落点（如"角色/林晚.md"），update/archive 为现有文件'
    }),
    content: Type.Optional(
      Type.String({ description: 'create/update 必填：完整的新文件内容（含 frontmatter）；archive 不填' })
    ),
    relatedTo: Type.Optional(Type.Array(Type.String(), { description: '双链到相关资产' }))
  },
  { additionalProperties: false }
);

/**
 * memory_propose：对资产库提出修改提议，落 pending 待作者确认——资产零直改的唯一变更通道。
 *
 * 提议本身只写 pending 目录（等同提交一份待审申请，应用与否由作者在确认流决定），
 * 因此分级 readonly；目标路径合法性与 contentHash 快照由 store 统一处理。
 */
export function createMemoryProposeTool(
  context: MemoryToolContext & { pendingStore: MemoryPendingStore }
): ToolDefinition<typeof memoryProposeParameters> {
  return {
    name: 'memory_propose',
    riskLevel: 'readonly',
    label: '资产修改提议',
    description:
      '对角色、设定、大纲、伏笔等资产文件提出修改提议（落 pending，作者确认后才应用）。' +
      '资产文件是作者领地，任何新增/更新/归档都必须走本工具而不是直接写文件。' +
      'update 需给出完整新内容（基于当前文件内容修改，不要凭记忆重写）。' +
      '一次提议只改一个文件、一件事。',
    parameters: memoryProposeParameters,
    async execute(params) {
      const sessionId = context.getSessionId();

      if (!sessionId) {
        throw new Error('当前会话尚未就绪，无法提交提议');
      }

      if (params.proposalType !== 'archive' && !params.content?.trim()) {
        throw new Error(`${params.proposalType} 提议必须提供完整的新文件内容（content）`);
      }

      const cwd = await context.resolveCwd();
      const proposal = await context.pendingStore.add(cwd, {
        proposalType: params.proposalType,
        title: params.title,
        reason: params.reason,
        targetPath: params.targetPath,
        ...(params.relatedTo?.length ? { relatedTo: params.relatedTo } : {}),
        source: `session:${sessionId}`,
        ...(params.content ? { content: params.content } : {})
      });

      return {
        text: `提议已提交（${proposal.id}），等待作者在界面上确认。请勿假设提议已生效。`,
        details: { id: proposal.id, proposalType: proposal.proposalType, targetPath: proposal.targetPath }
      };
    }
  };
}

/** 文件名净化：去掉路径分隔与 Windows 非法字符，防止标题携带穿越片段。 */
function sanitizeFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replaceAll('..', '');

  return cleaned || '未命名笔记';
}

/** 同名笔记不覆盖：追加序号直到可用（观察可能多次记录同一主题）。 */
async function uniqueNoteFileName(notesDir: string, base: string): Promise<string> {
  for (let index = 0; ; index += 1) {
    const name = index === 0 ? `${base}.md` : `${base}-${index + 1}.md`;
    const exists = await fs
      .access(path.join(notesDir, name))
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      return name;
    }
  }
}
