import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  ContentDeleteValidator,
  ContentReadValidator,
  ContentSaveValidator,
  type ContentContext,
  type ContentDeleteArgs,
  type ContentReadArgs,
  type ContentSaveArgs
} from '@chaptale/ipc-contract';
import type {
  ContentDeletePreview,
  ContentDocument,
  ContentEntry,
  ContentKind,
  ContentList,
  ContentScope
} from '@chaptale/shared';

import { WorkspaceLayoutService } from '../../core/workspace/layout';
import { createTextAtomically, writeTextAtomically } from '../../infra/filesystem/atomic-text';
import { readManagedText, resolveManagedPath } from '../../infra/filesystem/managed-text';
import { withFileWriteLock } from '../../infra/filesystem/write-lock';
import { contentHash, describeContent } from './codec';
import { inspectContentFiles } from './files';

type Location = { root: string; relative: string };
const kinds: ContentKind[] = ['persona', 'skill', 'template'];
const directoryNames = { persona: 'personas', skill: 'skills', template: 'templates' };
const defaultPath = (kind: ContentKind, id: string) => (kind === 'skill' ? `${id}/SKILL.md` : `${id}.md`);
const entryKey = (entry: Pick<ContentEntry, 'kind' | 'id'>) => `${entry.kind}:${entry.id}`;
const archiveName = '[a-z][a-z0-9-]{0,79}-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const archivedFile = new RegExp(`^\\.archive/${archiveName}\\.md$`);
const archivedSkill = new RegExp(`^\\.archive/${archiveName}/SKILL\\.md$`);
const isArchivePath = (kind: ContentKind, relative: string) =>
  archivedFile.test(relative) || (kind === 'skill' && archivedSkill.test(relative));
const includesSkillDirectory = (entry: Pick<ContentEntry, 'kind' | 'sourcePath'>) =>
  entry.kind === 'skill' && entry.sourcePath.endsWith('/SKILL.md');
export const contentRefKey = (entry: Pick<ContentEntry, 'source' | 'kind' | 'sourcePath'>) =>
  `${entry.source}:${entry.kind}:${entry.sourcePath}`;

export class ContentService {
  constructor(
    private readonly options: {
      userRoot: string;
      currentWorkspace: () => Promise<string | null>;
      builtins: readonly { kind: ContentKind; markdown: string }[];
    }
  ) {}

  async assertContext(args: ContentContext) {
    if ((await this.options.currentWorkspace()) !== (args.rootPath ?? null))
      throw new Error('作品已切换，请重新打开内容管理');
  }
  private async location(args: ContentContext, scope: ContentScope, kind: ContentKind): Promise<Location> {
    await this.assertContext(args);
    if (scope === 'user') return { root: this.options.userRoot, relative: directoryNames[kind] };
    if (!args.rootPath) throw new Error('请先打开作品');
    const relative =
      kind === 'template'
        ? (await new WorkspaceLayoutService().read(args.rootPath)).roles.templates.relativePath
        : `.chaptale/${directoryNames[kind]}`;
    return { root: args.rootPath, relative };
  }
  private async filename(
    args: ContentContext,
    scope: ContentScope,
    kind: ContentKind,
    sourcePath: string,
    archived = false
  ) {
    if (
      archived
        ? !isArchivePath(kind, sourcePath)
        : sourcePath.split('/').some(part => part.startsWith('.')) ||
          (kind === 'skill' ? !/^[a-z0-9-]+\/SKILL\.md$/.test(sourcePath) : !/\.md$/i.test(sourcePath))
    )
      throw new Error('内容路径无效');
    if (!archived && kind === 'persona' && sourcePath.includes('/')) throw new Error('专员文件必须在专员目录内');
    const location = await this.location(args, scope, kind);
    const relative = `${location.relative}/${sourcePath}`;
    return { ...location, relative, target: await resolveManagedPath(location.root, relative) };
  }
  async list(args: ContentContext): Promise<ContentList> {
    await this.assertContext(args);
    const entries: ContentEntry[] = [];
    const diagnostics: string[] = [];
    let bytes = 0;
    const add = (
      kind: ContentKind,
      source: ContentEntry['source'],
      sourcePath: string,
      markdown: string,
      archived = false
    ) => {
      bytes += Buffer.byteLength(markdown);
      if (bytes > 8 * 1024 * 1024) throw new Error('内容目录超过 8 MiB 扫描上限');
      const described = describeContent(kind, markdown);
      entries.push({
        ...described,
        kind,
        source,
        sourcePath,
        hash: contentHash(markdown),
        effective: false,
        ...(archived ? { archived: true } : {})
      });
    };
    for (const item of this.options.builtins) {
      const { id } = describeContent(item.kind, item.markdown);
      add(item.kind, 'builtin', id, item.markdown);
    }
    for (const scope of (args.rootPath ? ['user', 'workspace'] : ['user']) as ContentScope[]) {
      for (const kind of kinds) {
        const location = await this.location(args, scope, kind);
        let scanned = 0;
        const scan = async (relative: string, depth: number) => {
          const target = await resolveManagedPath(
            location.root,
            `${location.relative}${relative ? `/${relative}` : ''}`
          );
          let children;
          try {
            children = await readdir(target, { withFileTypes: true });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            return;
          }
          for (const child of children.toSorted((a, b) => a.name.localeCompare(b.name))) {
            if (++scanned > 300 || bytes > 8 * 1024 * 1024) throw new Error('内容扫描达到数量或体积上限');
            if (child.name.startsWith('.')) continue;
            const sourcePath = relative ? `${relative}/${child.name}` : child.name;
            if (child.isSymbolicLink()) {
              diagnostics.push(`${sourcePath}: 不读取链接`);
              continue;
            }
            if (child.isDirectory()) {
              if (depth < (kind === 'template' ? 4 : kind === 'skill' ? 1 : 0)) await scan(sourcePath, depth + 1);
            } else if (
              child.isFile() &&
              (kind === 'skill' ? child.name === 'SKILL.md' && depth === 1 : /\.md$/i.test(child.name))
            ) {
              try {
                const markdown = await readManagedText(location.root, `${location.relative}/${sourcePath}`);
                add(kind, scope, sourcePath, markdown);
              } catch (error) {
                diagnostics.push(`${scope}/${sourcePath}: ${String(error)}`);
              }
            }
          }
        };
        try {
          await scan('', 0);
        } catch (error) {
          diagnostics.push(`${scope}/${kind}: ${String(error)}`);
        }
        try {
          const directory = await resolveManagedPath(location.root, `${location.relative}/.archive`);
          const children = await readdir(directory, { withFileTypes: true });
          for (const child of children.toSorted((a, b) => a.name.localeCompare(b.name))) {
            if (++scanned > 600) throw new Error('内容与归档扫描达到数量上限');
            const sourcePath = `.archive/${child.name}${child.isDirectory() ? '/SKILL.md' : ''}`;
            if (!isArchivePath(kind, sourcePath)) continue;
            try {
              const markdown = await readManagedText(location.root, `${location.relative}/${sourcePath}`);
              add(kind, scope, sourcePath, markdown, true);
            } catch (error) {
              diagnostics.push(`${scope}/${sourcePath}: ${String(error)}`);
            }
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            diagnostics.push(`${scope}/${kind}/.archive: ${String(error)}`);
        }
      }
    }
    const effective = new Map<string, ContentEntry>();
    for (const entry of entries) {
      if (entry.archived) continue;
      const previous = effective.get(entryKey(entry));
      if (previous?.source === entry.source) diagnostics.push(`${entry.source}/${entry.id}: 同层存在重复 id`);
      effective.set(entryKey(entry), entry);
    }
    for (const entry of effective.values()) entry.effective = true;
    await this.assertContext(args);
    return { entries, diagnostics };
  }
  async read(args: ContentReadArgs): Promise<ContentDocument> {
    if (!ContentReadValidator.Check([args])) throw new Error('内容读取参数无效');
    await this.assertContext(args);
    const ref = args.ref;
    let markdown: string;
    if (ref.source === 'builtin') {
      if (ref.archived) throw new Error('内置内容不能归档');
      const found = this.options.builtins.find(
        item => item.kind === ref.kind && describeContent(item.kind, item.markdown).id === ref.id
      );
      if (!found || ref.sourcePath !== ref.id) throw new Error('内置内容不存在');
      markdown = found.markdown;
    } else {
      const location = await this.filename(args, ref.source, ref.kind, ref.sourcePath, ref.archived);
      markdown = await readManagedText(location.root, location.relative);
    }
    const described = describeContent(ref.kind, markdown);
    if (described.id !== ref.id || contentHash(markdown) !== ref.hash) throw new Error('内容已变化，请刷新后重新打开');
    await this.assertContext(args);
    return { ...ref, ...described, markdown, effective: !ref.archived };
  }
  async save(args: ContentSaveArgs): Promise<ContentDocument> {
    if (!ContentSaveValidator.Check([args])) throw new Error('内容保存参数无效');
    const described = describeContent(args.kind, args.markdown);
    if (described.id !== args.id) throw new Error('内容 id 与目标不一致');
    const sourcePath = args.sourcePath ?? defaultPath(args.kind, args.id);
    const location = await this.filename(args, args.scope, args.kind, sourcePath);
    const base = await this.location(args, args.scope, args.kind);
    const lock = await resolveManagedPath(base.root, `${base.relative}/.content-management`);
    // 同一内容目录串行管理，既保护同路径写入，也保护同 id 的不同文件名。
    return withFileWriteLock(lock, () =>
      withFileWriteLock(location.target, async () => {
        const listed = await this.list(args);
        const matches = listed.entries.filter(
          entry => !entry.archived && entry.source === args.scope && entry.kind === args.kind && entry.id === args.id
        );
        if (matches.some(entry => entry.sourcePath !== sourcePath))
          throw new Error('此范围已有同 id 内容，请编辑原条目');
        if (args.expectedHash) {
          await this.read({
            rootPath: args.rootPath,
            ref: {
              kind: args.kind,
              id: args.id,
              source: args.scope,
              sourcePath,
              hash: args.expectedHash
            }
          });
        }
        await mkdir(path.dirname(location.target), { recursive: true });
        await resolveManagedPath(location.root, location.relative);
        await this.assertContext(args);
        if (args.expectedHash) await writeTextAtomically(location.target, args.markdown);
        else await createTextAtomically(location.target, args.markdown);
        return {
          ...described,
          kind: args.kind,
          source: args.scope,
          sourcePath,
          hash: contentHash(args.markdown),
          markdown: args.markdown,
          effective: true
        };
      })
    );
  }
  private async manage<T>(
    args: ContentReadArgs,
    action: (document: ContentDocument, location: Location & { target: string }, base: Location) => Promise<T>
  ) {
    if (!ContentReadValidator.Check([args])) throw new Error('内容管理参数无效');
    if (args.ref.source === 'builtin') throw new Error('内置内容只读，不能归档、恢复或删除');
    const location = await this.filename(args, args.ref.source, args.ref.kind, args.ref.sourcePath, args.ref.archived);
    const base = await this.location(args, args.ref.source, args.ref.kind);
    const lock = await resolveManagedPath(base.root, `${base.relative}/.content-management`);
    return withFileWriteLock(lock, () =>
      withFileWriteLock(location.target, async () => action(await this.read(args), location, base))
    );
  }
  async archive(args: ContentReadArgs) {
    if (args.ref.archived) throw new Error('此内容已经归档');
    await this.manage(args, async (_document, location, base) => {
      const directory = includesSkillDirectory(args.ref);
      const source = directory ? path.posix.dirname(location.relative) : location.relative;
      if (directory) await inspectContentFiles(location.root, source);
      const relative = `${base.relative}/.archive/${args.ref.id}-${randomUUID()}${directory ? '' : '.md'}`;
      const archived = await resolveManagedPath(base.root, relative);
      await mkdir(path.dirname(archived), { recursive: true });
      await resolveManagedPath(base.root, relative);
      const target = await resolveManagedPath(location.root, source);
      await this.assertContext(args);
      await rename(target, archived);
    });
  }
  async restore(args: ContentReadArgs): Promise<ContentDocument> {
    if (!args.ref.archived) throw new Error('只能恢复已归档的内容');
    return this.manage(args, async (document, location, base) => {
      const { ref } = args;
      const sourcePath = defaultPath(ref.kind, ref.id);
      const relative = `${base.relative}/${sourcePath}`;
      const target = await resolveManagedPath(base.root, relative);
      const list = await this.list(args);
      if (
        list.entries.some(
          entry => !entry.archived && entry.source === ref.source && entry.kind === ref.kind && entry.id === ref.id
        )
      )
        throw new Error('此范围已有同 id 内容，不能覆盖恢复；可先复制为其他标识');
      if (includesSkillDirectory(ref)) {
        await inspectContentFiles(location.root, path.posix.dirname(location.relative));
        try {
          await lstat(path.dirname(target));
          throw new Error('技能目标目录已存在，不能覆盖恢复');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await this.assertContext(args);
        await resolveManagedPath(base.root, relative);
        await resolveManagedPath(location.root, location.relative);
        await rename(path.dirname(location.target), path.dirname(target));
      } else {
        await mkdir(path.dirname(target), { recursive: true });
        await resolveManagedPath(base.root, relative);
        await this.assertContext(args);
        await createTextAtomically(target, document.markdown);
        await resolveManagedPath(location.root, location.relative);
        await rm(location.target);
      }
      return { ...document, sourcePath, archived: false, effective: true };
    });
  }
  private async deletionScope(args: ContentReadArgs, location: Location): Promise<ContentDeletePreview> {
    const directory = includesSkillDirectory(args.ref);
    const relative = directory ? path.posix.dirname(location.relative) : location.relative;
    const snapshot = await inspectContentFiles(location.root, relative);
    const prefix = directory ? path.posix.dirname(args.ref.sourcePath) : args.ref.sourcePath;
    const warnings = ['永久删除，不进入回收站。历史会话、运行记录与冻结参考保持不变。'];
    if (args.ref.kind === 'skill' && args.ref.archived && !directory)
      warnings.push('这是旧格式技能归档，仅删除归档的 SKILL.md，不删除原目录或同名活动技能的附件。');
    if (!args.ref.archived) warnings.push('同名低优先级内容可能重新生效；其他内容中的引用不会自动删除。');
    await this.assertContext(args);
    return {
      ...snapshot,
      files: snapshot.files.map(file => ({ bytes: file.bytes, path: file.path ? `${prefix}/${file.path}` : prefix })),
      warnings
    };
  }
  async previewDelete(args: ContentReadArgs): Promise<ContentDeletePreview> {
    return this.manage(args, (_document, location) => this.deletionScope(args, location));
  }
  async delete(args: ContentDeleteArgs) {
    if (!ContentDeleteValidator.Check([args])) throw new Error('内容删除参数无效');
    const readArgs: ContentReadArgs = { rootPath: args.rootPath, ref: args.ref };
    await this.manage(readArgs, async (_document, location) => {
      const snapshot = await this.deletionScope(readArgs, location);
      if (snapshot.fingerprint !== args.fingerprint) throw new Error('删除范围已变化，请重新预览并确认');
      const directory = includesSkillDirectory(args.ref);
      const relative = directory ? path.posix.dirname(location.relative) : location.relative;
      const target = await resolveManagedPath(location.root, relative);
      await this.assertContext(args);
      await rm(target, { recursive: directory });
    });
  }
}
