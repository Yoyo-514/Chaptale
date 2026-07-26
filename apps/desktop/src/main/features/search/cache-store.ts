import path from 'node:path';
import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

import { toWorkspaceSessionDirName } from '../../core/settings/workspace-session-directory';
import { readJsonFile, writeJsonFile } from '../../infra/filesystem/files';
import type { IndexChunk } from './types';

export type IndexCacheEnvelope = {
  schemaVersion: 1;
  workspaceKey: string;
  sourceFingerprint: string;
  dictionaryFingerprint: string;
  tokenizerId: string;
  /** 恢复 workspace Jieba 词典所需；命中 cache 时无需重读 Markdown frontmatter。 */
  customTerms: string[];
  chunkConfig: { maxTokens: number; overlapTokens: number };
  generatedAt: string;
  chunks: IndexChunk[];
  miniSearch: unknown;
};

export interface IndexCachePort {
  read(cwd: string): Promise<IndexCacheEnvelope | undefined>;
  write(cwd: string, value: IndexCacheEnvelope): Promise<void>;
}

const ChunkSchema = Type.Object(
  {
    id: Type.String(),
    sourcePath: Type.String(),
    domain: Type.Union([Type.Literal('canon'), Type.Literal('notes'), Type.Literal('summaries')]),
    role: Type.Union([
      Type.Literal('outline'),
      Type.Literal('world'),
      Type.Literal('characters'),
      Type.Literal('threads'),
      Type.Literal('notes'),
      Type.Literal('summaries')
    ]),
    title: Type.String(),
    kind: Type.Optional(Type.String()),
    headingPath: Type.Array(Type.String()),
    ordinal: Type.Number(),
    startOffset: Type.Number(),
    endOffset: Type.Number(),
    previousId: Type.Optional(Type.String()),
    nextId: Type.Optional(Type.String()),
    body: Type.String(),
    pinyin: Type.String()
  },
  { additionalProperties: false }
);

// MiniSearch payload 由库自身加载校验；这里只深检 manifest/chunks，避免大型倒排数据被重复遍历。
const EnvelopeValidator = Compile(
  Type.Object(
    {
      schemaVersion: Type.Literal(1),
      workspaceKey: Type.String(),
      sourceFingerprint: Type.String(),
      dictionaryFingerprint: Type.String(),
      tokenizerId: Type.String(),
      customTerms: Type.Array(Type.String()),
      chunkConfig: Type.Object(
        { maxTokens: Type.Number(), overlapTokens: Type.Number() },
        { additionalProperties: false }
      ),
      generatedAt: Type.String(),
      chunks: Type.Array(ChunkSchema),
      miniSearch: Type.Unknown()
    },
    { additionalProperties: false }
  )
);

/** cache 是可删除的派生数据；路径与会话目录使用同一 workspace key，避免同名作品碰撞。 */
export class IndexCacheStore implements IndexCachePort {
  constructor(private readonly cacheRoot: string) {}

  resolvePath(cwd: string): string {
    return path.join(this.cacheRoot, toWorkspaceSessionDirName(cwd), 'index', 'keywords', 'index-v1.json');
  }

  async read(cwd: string): Promise<IndexCacheEnvelope | undefined> {
    const value = await readJsonFile<unknown>(this.resolvePath(cwd));
    return value && EnvelopeValidator.Check(value) ? (value as IndexCacheEnvelope) : undefined;
  }

  async write(cwd: string, value: IndexCacheEnvelope): Promise<void> {
    await writeJsonFile(this.resolvePath(cwd), value);
  }
}
