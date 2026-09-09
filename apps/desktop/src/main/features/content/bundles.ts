import {
  ContentBundleValidator,
  ContentExportValidator,
  ContentImportValidator,
  ContentPreviewValidator,
  type ContentBundle,
  type ContentExportArgs,
  type ContentImportArgs,
  type ContentPreviewArgs
} from '@chaptale/ipc-contract';
import type { ContentImportEntry, ContentImportPreview } from '@chaptale/shared';

import { contentHash, describeContent, portableContent } from './codec';
import type { ContentService } from './service';

export function parseContentBundle(text: string): ContentBundle {
  if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error('分享包不能超过 4 MiB');
  const bundle: unknown = JSON.parse(text);
  if (!ContentBundleValidator.Check(bundle)) throw new Error('分享包格式或版本不支持');
  const keys = new Set<string>();
  for (const item of bundle.entries) {
    const key = `${item.kind}:${item.id}`;
    if (keys.has(key)) throw new Error('分享包包含重复条目');
    keys.add(key);
    if (contentHash(item.markdown) !== item.hash || describeContent(item.kind, item.markdown).id !== item.id)
      throw new Error(`内容校验失败：${item.id}`);
  }
  return bundle;
}

export class ContentBundles {
  constructor(private readonly content: ContentService) {}
  async previewExport(args: ContentExportArgs) {
    if (!ContentExportValidator.Check([args])) throw new Error('导出参数无效');
    const entries: ContentBundle['entries'] = [];
    for (const ref of args.refs) {
      const document = await this.content.read({ rootPath: args.rootPath, ref });
      const { markdown } = portableContent(ref.kind, document.markdown);
      entries.push({ kind: ref.kind, id: ref.id, markdown, hash: contentHash(markdown) });
    }
    const text = JSON.stringify({ format: 'chaptale-content', version: 1, entries } satisfies ContentBundle, null, 2);
    parseContentBundle(text);
    return text;
  }
  async previewImport(args: ContentPreviewArgs): Promise<ContentImportPreview> {
    if (!ContentPreviewValidator.Check([args])) throw new Error('导入参数无效');
    const bundle = parseContentBundle(args.text);
    const { entries } = await this.content.list(args);
    if (args.scope === 'workspace' && !args.rootPath) throw new Error('请先打开作品');
    return {
      entries: bundle.entries.map(item => {
        const { markdown, warnings } = portableContent(item.kind, item.markdown);
        const described = describeContent(item.kind, markdown);
        const conflicts = entries.filter(
          entry => !entry.archived && entry.source === args.scope && entry.id === item.id && entry.kind === item.kind
        );
        if (conflicts.length > 1) throw new Error(`同层存在重复 id，先整理原文件：${item.id}`);
        const conflict = conflicts[0];
        const result: ContentImportEntry = {
          kind: item.kind,
          id: item.id,
          name: described.name,
          markdown,
          warnings
        };
        if (conflict)
          result.conflict = {
            kind: conflict.kind,
            id: conflict.id,
            source: conflict.source,
            sourcePath: conflict.sourcePath,
            hash: conflict.hash
          };
        return result;
      })
    };
  }
  async import(args: ContentImportArgs) {
    if (!ContentImportValidator.Check([args])) throw new Error('导入确认无效');
    const preview = await this.previewImport({ rootPath: args.rootPath, scope: args.scope, text: args.text });
    const imported: string[] = [];
    const errors: string[] = [];
    const selected = new Set<string>();
    for (const choice of args.selected) {
      const key = `${choice.kind}:${choice.id}`;
      if (selected.has(key)) throw new Error('导入选择重复');
      selected.add(key);
      const item = preview.entries.find(value => value.kind === choice.kind && value.id === choice.id);
      if (!item) throw new Error('导入选择不在分享包中');
      const sameTarget =
        (!item.conflict && !choice.overwrite) ||
        (item.conflict &&
          choice.overwrite &&
          (['kind', 'id', 'source', 'sourcePath', 'hash'] as const).every(
            field => item.conflict![field] === choice.overwrite![field]
          ));
      if (!sameTarget) {
        errors.push(`${choice.id}: 目标已变化或未确认覆盖`);
        continue;
      }
      try {
        await this.content.save({
          rootPath: args.rootPath,
          kind: item.kind,
          scope: args.scope,
          id: item.id,
          markdown: item.markdown,
          ...(choice.overwrite ? { sourcePath: choice.overwrite.sourcePath, expectedHash: choice.overwrite.hash } : {})
        });
        imported.push(key);
      } catch (error) {
        errors.push(`${choice.id}: ${String(error)}`);
      }
    }
    return { imported, errors };
  }
}
