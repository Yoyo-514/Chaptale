import { createHash, randomUUID } from 'node:crypto';
import { stringify } from 'yaml';

import type { ComposePackArgs, PackFreshness } from '@chaptale/ipc-contract';
import {
  escapeXmlAttribute,
  escapeXmlText,
  ReferencePackValidator,
  type ReferencePack,
  type ReferenceSection
} from '@chaptale/shared';

import { estimateTextTokens } from '../../core/context/token-counter';
import { createArtifact, resolveArtifactPath } from '../../core/workspace/artifacts';
import type { WorkspaceIndexWorker } from '../search/index/worker-client';
import type { WorkspaceService } from '../workspace/service';

export class LibraryService {
  constructor(
    private readonly workspace: Pick<WorkspaceService, 'getState' | 'readDocument'>,
    private readonly index: Pick<WorkspaceIndexWorker, 'listAssets' | 'resolveLink'>
  ) {}

  async assertWorkspace(rootPath: string) {
    if ((await this.workspace.getState()).rootPath !== rootPath) throw new Error('工作区已经切换');
  }

  async listAssets(rootPath: string) {
    await this.assertWorkspace(rootPath);
    const snapshot = await this.index.listAssets(rootPath);
    await this.assertWorkspace(rootPath);
    return snapshot;
  }

  async resolveLink(rootPath: string, link: string) {
    await this.assertWorkspace(rootPath);
    return this.index.resolveLink(rootPath, link);
  }

  async composePack(args: ComposePackArgs): Promise<ReferencePack> {
    await this.assertWorkspace(args.rootPath);
    const sections: ReferenceSection[] = [];
    const seen = new Set<string>();
    let totalBytes = Buffer.byteLength(args.goal);
    for (const selection of args.selections) {
      const key = `${selection.sourcePath}\0${selection.quote ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const read = await this.workspace.readDocument({
        rootPath: args.rootPath,
        relativePath: selection.sourcePath,
        maxBytes: 8 * 1024 * 1024
      });
      if (!read.ok) throw new Error(`${selection.sourcePath}: ${read.message}`);
      const document = read.document;
      const head = document.head.status === 'ok' ? document.head.frontmatter : {};
      if (
        selection.quote !== undefined &&
        (!selection.quote ||
          !document.content.replace(/\r\n?/g, '\n').includes(selection.quote.replace(/\r\n?/g, '\n')))
      ) {
        throw new Error(`${selection.sourcePath} 中的选段已变化，请重新选择`);
      }
      const content =
        selection.quote ??
        (selection.mode === 'summary'
          ? `${stringify(head).trim()}\n\n${document.head.body
              .split(/\r?\n/)
              .filter(line => line.trim())
              .slice(0, 3)
              .join('\n')}`.trim()
          : document.content);
      totalBytes += Buffer.byteLength(content);
      if (totalBytes > 8 * 1024 * 1024) throw new Error('参考总量超过 8 MiB，请减少来源后重试；未截断原文');
      sections.push({
        ...selection,
        title: typeof head.title === 'string' ? head.title : selection.sourcePath.split('/').at(-1)!,
        ...(typeof head.id === 'string' ? { sourceId: head.id } : {}),
        sourceHash: document.contentHash,
        updatedAt: new Date(document.mtimeMs).toISOString(),
        content,
        chars: content.length,
        tokens: estimateTextTokens(content)
      });
    }
    await this.assertWorkspace(args.rootPath);
    const goal = args.goal.trim();
    const prompt = renderReferencePrompt(goal, sections);
    return {
      id: '',
      createdAt: '',
      goal,
      ...(args.scenePath ? { scenePath: args.scenePath } : {}),
      budgetChars: args.budgetChars,
      sections,
      chars: goal.length + sections.reduce((sum, section) => sum + section.chars, 0),
      tokens: estimateTextTokens(prompt),
      prompt
    };
  }

  async freezePack(args: ComposePackArgs) {
    const pack = await this.composePack(args);
    if (!pack.goal && !pack.sections.length) throw new Error('请填写写作目标或选择参考内容');
    pack.id = randomUUID();
    pack.createdAt = new Date().toISOString();
    await this.assertWorkspace(args.rootPath);
    await createArtifact(args.rootPath, `.chaptale/packs/${pack.id}.md`, serializePack(pack));
    return pack;
  }

  async readPack(rootPath: string, packId: string): Promise<ReferencePack> {
    await this.assertWorkspace(rootPath);
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(packId)) throw new Error('参考快照 id 不合法');
    const relativePath = `.chaptale/packs/${packId}.md`;
    await resolveArtifactPath(rootPath, relativePath);
    const result = await this.workspace.readDocument({ rootPath, relativePath, maxBytes: 16 * 1024 * 1024 });
    if (!result.ok) throw new Error(result.message);
    const head = result.document.head;
    if (head.status !== 'ok') throw new Error('参考快照元数据损坏');
    const metadata = head.frontmatter;
    if (!Array.isArray(metadata.sections)) throw new Error('参考快照缺少来源');
    if (metadata.bodyHash !== createHash('sha256').update(head.body).digest('hex')) {
      throw new Error('参考快照正文已被修改，请重新组装');
    }
    const sections = metadata.sections.map((value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('参考快照来源损坏');
      const section = value as Record<string, unknown>;
      const start = section.start;
      const end = section.end;
      if (
        typeof start !== 'number' ||
        typeof end !== 'number' ||
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end < start ||
        end > head.body.length
      ) {
        throw new Error('参考快照内容范围损坏');
      }
      const { start: _start, end: _end, ...source } = section;
      return { ...source, content: head.body.slice(start, end) };
    });
    const pack = { ...metadata, sections, prompt: '' };
    if (!ReferencePackValidator.Check(pack) || pack.id !== packId) throw new Error('参考快照校验失败');
    pack.prompt = renderReferencePrompt(pack.goal, pack.sections);
    await this.assertWorkspace(rootPath);
    return pack;
  }

  async checkPack(rootPath: string, packId: string): Promise<PackFreshness> {
    const pack = await this.readPack(rootPath, packId);
    const sources: PackFreshness['sources'] = [];
    for (const section of pack.sections) {
      const result = await this.workspace.readDocument({
        rootPath,
        relativePath: section.sourcePath,
        maxBytes: 8 * 1024 * 1024
      });
      sources.push({
        sourcePath: section.sourcePath,
        state: !result.ok ? 'missing' : result.document.contentHash === section.sourceHash ? 'current' : 'changed'
      });
    }
    return { stale: sources.some(source => source.state !== 'current'), sources };
  }
}

/** 不把随机 id、冻结时间或文件 mtime 放入模型前缀。 */
export function renderReferencePrompt(goal: string, sections: readonly ReferenceSection[]) {
  return [
    '<writing_reference trust="source-data">',
    ...sections.map(
      section =>
        `<source path="${escapeXmlAttribute(section.sourcePath)}">\n${escapeXmlText(section.content)}\n</source>`
    ),
    '</writing_reference>',
    '<writing_goal>',
    escapeXmlText(goal),
    '</writing_goal>'
  ].join('\n');
}

function serializePack(pack: ReferencePack) {
  let body = `# 本次写作参考\n\n## 写作目标\n\n${pack.goal}\n\n`;
  const sections = pack.sections.map(section => {
    body += `## ${section.title.replaceAll('\n', ' ')}\n\n`;
    const start = body.length;
    body += section.content;
    const end = body.length;
    body += '\n\n';
    const { content: _content, ...metadata } = section;
    return { ...metadata, start, end };
  });
  const { prompt: _prompt, ...metadata } = pack;
  const header = stringify({
    ...metadata,
    kind: 'context-pack',
    bodyHash: createHash('sha256').update(body).digest('hex'),
    sections
  });
  if (Buffer.byteLength(header) > 64 * 1024) throw new Error('参考来源元数据超过 64 KiB，请减少来源数量');
  return `---\n${header}---\n${body}`;
}
