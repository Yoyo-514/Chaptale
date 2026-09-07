import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';

import { WorkspaceRelativePathSchema, WorkspaceRoleSchema } from './workspace';

export const AssetLinkSchema = Type.Object({
  link: Type.String(),
  status: Type.Union([
    Type.Literal('resolved'),
    Type.Literal('moved'),
    Type.Literal('missing'),
    Type.Literal('ambiguous')
  ]),
  targetPath: Type.Optional(WorkspaceRelativePathSchema),
  candidates: Type.Array(WorkspaceRelativePathSchema)
});
export type AssetLink = Static<typeof AssetLinkSchema>;

export const AssetRecordSchema = Type.Object({
  sourcePath: WorkspaceRelativePathSchema,
  id: Type.Optional(Type.String()),
  role: Type.Union([WorkspaceRoleSchema, Type.Literal('notes'), Type.Literal('summaries')]),
  title: Type.String(),
  kind: Type.Optional(Type.String()),
  status: Type.Optional(Type.String()),
  aliases: Type.Array(Type.String()),
  frontmatter: Type.Record(Type.String(), Type.Unknown()),
  contentHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  updatedAt: Type.String(),
  sizeBytes: Type.Number(),
  chars: Type.Number(),
  excerpt: Type.String(),
  links: Type.Array(AssetLinkSchema),
  backlinks: Type.Array(WorkspaceRelativePathSchema),
  diagnostic: Type.Optional(Type.String())
});
export type AssetRecord = Static<typeof AssetRecordSchema>;
export const AssetRecordValidator = Compile(AssetRecordSchema);
export type AssetSnapshot = {
  rootPath: string;
  assets: AssetRecord[];
  diagnostics: Array<{ code: string; message: string; sourcePath?: string }>;
};

export const ReferenceSelectionSchema = Type.Object(
  {
    sourcePath: WorkspaceRelativePathSchema,
    pinned: Type.Boolean(),
    mode: Type.Union([Type.Literal('full'), Type.Literal('summary')]),
    quote: Type.Optional(Type.String({ maxLength: 1_000_000 })),
    reason: Type.Optional(Type.String({ maxLength: 500 }))
  },
  { additionalProperties: false }
);
export type ReferenceSelection = Static<typeof ReferenceSelectionSchema>;
export const ReferenceSectionSchema = Type.Object({
  ...ReferenceSelectionSchema.properties,
  title: Type.String(),
  sourceId: Type.Optional(Type.String()),
  sourceHash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  updatedAt: Type.String(),
  content: Type.String(),
  chars: Type.Number(),
  tokens: Type.Number()
});
export type ReferenceSection = Static<typeof ReferenceSectionSchema>;
export const ReferencePackSchema = Type.Object({
  id: Type.String(),
  createdAt: Type.String(),
  goal: Type.String(),
  scenePath: Type.Optional(WorkspaceRelativePathSchema),
  budgetChars: Type.Integer({ minimum: 1 }),
  sections: Type.Array(ReferenceSectionSchema),
  chars: Type.Number(),
  tokens: Type.Number(),
  prompt: Type.String()
});
export type ReferencePack = Static<typeof ReferencePackSchema>;
export const ReferencePackValidator = Compile(ReferencePackSchema);

function normalizeLink(value: string) {
  return value.normalize('NFC').toLowerCase().replace(/\.md$/i, '');
}

/** 双链重名返回所有候选；只有路径或唯一稳定 id 才能消除歧义。 */
export function resolveAssetLink(
  raw: string,
  assets: readonly Pick<AssetRecord, 'sourcePath' | 'title' | 'id' | 'aliases'>[],
  movedPaths: Readonly<Record<string, string>> = {}
): AssetLink {
  const target = raw
    .replace(/^\[\[|\]\]$/g, '')
    .split(/[|#]/)[0]!
    .trim();
  const key = normalizeLink(target);
  let matches = assets.filter(asset => normalizeLink(asset.sourcePath) === key || asset.id === target);
  let moved = false;
  if (!matches.length && movedPaths[key]) {
    matches = assets.filter(asset => asset.id === movedPaths[key]);
    moved = matches.length === 1;
  }
  if (!matches.length && !target.includes('/')) {
    matches = assets.filter(asset =>
      [asset.title, asset.sourcePath.split('/').at(-1)!, ...asset.aliases].some(value => normalizeLink(value) === key)
    );
  }
  // shared 的目标为 ES2022；排序仅修改刚创建的数组。
  // oxlint-disable-next-line unicorn/no-array-sort
  const candidates = matches.map(asset => asset.sourcePath).sort();
  return {
    link: raw,
    status: matches.length === 1 ? (moved ? 'moved' : 'resolved') : matches.length ? 'ambiguous' : 'missing',
    ...(matches.length === 1 ? { targetPath: matches[0]!.sourcePath } : {}),
    candidates
  };
}

export function extractAssetLinks(text: string): string[] {
  return [...new Set([...text.matchAll(/\[\[([^\]\r\n]+)\]\]/g)].map(match => match[0]))];
}
