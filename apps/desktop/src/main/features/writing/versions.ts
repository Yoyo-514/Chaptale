import { createHash, randomUUID } from 'node:crypto';
import { readdir, unlink } from 'node:fs/promises';

import type { WorkspaceDocument } from '@chaptale/ipc-contract';
import { VersionSnapshotValidator, type AssetRecord, type VersionSnapshot } from '@chaptale/shared';
import { parseDocumentFrontmatter } from '@chaptale/shared/document-frontmatter';

import { createArtifact, resolveArtifactPath } from '../../core/workspace/artifacts';
import { WorkspaceLayoutService } from '../../core/workspace/layout';
import { withFileWriteLock } from '../../infra/filesystem/write-lock';
import { readDocumentSnapshot } from '../workspace/read-document';

function versionDirectory(targetPath: string) {
  return `.chaptale/revisions/versions/${createHash('sha256').update(targetPath).digest('hex').slice(0, 24)}`;
}
type VersionDocument = Pick<WorkspaceDocument, 'rootPath' | 'relativePath' | 'content' | 'contentHash' | 'head'>;
export class VersionStore {
  constructor(
    private readonly assets?: (rootPath: string) => Promise<readonly Pick<AssetRecord, 'sourcePath' | 'id'>[]>
  ) {}

  async preserveFinalization(
    next: Pick<WorkspaceDocument, 'rootPath' | 'relativePath' | 'content'>,
    previous?: WorkspaceDocument
  ) {
    if (!/\.(md|markdown)$/i.test(next.relativePath) || next.relativePath.split('/').some(part => part.startsWith('.')))
      return;
    const head = parseDocumentFrontmatter(next.content);
    if (
      head.status !== 'ok' ||
      head.frontmatter.status !== 'final' ||
      (previous?.head.status === 'ok' && previous.head.frontmatter.status === 'final')
    )
      return;
    const layout = await new WorkspaceLayoutService().read(next.rootPath);
    if (
      head.frontmatter.kind !== 'chapter' &&
      (head.frontmatter.kind !== undefined || !next.relativePath.startsWith(`${layout.roles.manuscript.relativePath}/`))
    )
      return;
    const contentHash = createHash('sha256').update(next.content).digest('hex');
    if (
      (await this.list(next.rootPath, next.relativePath)).some(
        item => item.reason === 'final' && item.contentHash === contentHash
      )
    )
      return;
    await this.save({ ...next, head, contentHash }, 'final');
  }

  async save(
    document: VersionDocument,
    reason: VersionSnapshot['reason'],
    candidateId?: string,
    restoredFrom?: string
  ) {
    const id = randomUUID();
    const directory = versionDirectory(document.relativePath);
    const contentPath = `${directory}/${id}.md`;
    const snapshot: VersionSnapshot = {
      id,
      targetPath: document.relativePath,
      contentHash: document.contentHash,
      contentPath,
      reason,
      createdAt: new Date().toISOString(),
      ...(candidateId ? { candidateId } : {}),
      ...(restoredFrom ? { restoredFrom } : {}),
      ...(document.head.status === 'ok' &&
      typeof document.head.frontmatter.id === 'string' &&
      document.head.frontmatter.id
        ? { sourceId: document.head.frontmatter.id }
        : {})
    };
    await createArtifact(document.rootPath, contentPath, document.content);
    await createArtifact(document.rootPath, `${directory}/${id}.json`, JSON.stringify(snapshot));
    await this.prune(document.rootPath, document.relativePath);
    return snapshot;
  }
  async list(rootPath: string, targetPath: string) {
    const assets = await this.assets?.(rootPath);
    const id = assets?.find(asset => asset.sourcePath === targetPath)?.id;
    const sourceId = id && assets?.filter(asset => asset.id === id).length === 1 ? id : undefined;
    let directories = [versionDirectory(targetPath)];
    if (sourceId) {
      try {
        const entries = await readdir(await resolveArtifactPath(rootPath, '.chaptale/revisions/versions'), {
          withFileTypes: true
        });
        directories = entries
          .filter(entry => entry.isDirectory() && /^[a-f0-9]{24}$/.test(entry.name))
          .map(entry => `.chaptale/revisions/versions/${entry.name}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const snapshots: VersionSnapshot[] = [];
    for (const directory of directories) {
      for (const snapshot of await this.readDirectory(rootPath, directory)) {
        if (!sourceId) {
          if (snapshot.targetPath === targetPath) snapshots.push(snapshot);
          continue;
        }
        let snapshotSourceId = snapshot.sourceId;
        // 旧版本没有 sourceId，按不可变原文补读身份，不改写历史记录。
        if (!snapshotSourceId) {
          const head = parseDocumentFrontmatter(await this.content(rootPath, snapshot));
          if (head.status === 'ok' && typeof head.frontmatter.id === 'string') snapshotSourceId = head.frontmatter.id;
        }
        if (snapshotSourceId === sourceId || (!snapshotSourceId && snapshot.targetPath === targetPath))
          snapshots.push(snapshot);
      }
    }
    return snapshots.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }
  private async readDirectory(rootPath: string, directory: string) {
    const absolute = await resolveArtifactPath(rootPath, directory);
    let names: string[];
    try {
      names = await readdir(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const snapshots: VersionSnapshot[] = [];
    for (const name of names.filter(value => /^[a-zA-Z0-9-]+\.json$/.test(value))) {
      const document = await readDocumentSnapshot({
        rootPath,
        relativePath: `${directory}/${name}`,
        maxBytes: 128 * 1024
      });
      const snapshot: unknown = JSON.parse(document.content);
      if (
        !VersionSnapshotValidator.Check(snapshot) ||
        versionDirectory(snapshot.targetPath) !== directory ||
        snapshot.id !== name.slice(0, -5) ||
        snapshot.contentPath !== `${directory}/${snapshot.id}.md`
      ) {
        throw new Error(`版本记录损坏：${name}`);
      }
      snapshots.push(snapshot);
    }
    return snapshots;
  }
  async read(rootPath: string, targetPath: string, snapshotId: string) {
    const snapshot = (await this.list(rootPath, targetPath)).find(value => value.id === snapshotId);
    if (!snapshot) throw new Error('版本不存在');
    return { snapshot, content: await this.content(rootPath, snapshot) };
  }
  private async content(rootPath: string, snapshot: VersionSnapshot) {
    await resolveArtifactPath(rootPath, snapshot.contentPath);
    const document = await readDocumentSnapshot({
      rootPath,
      relativePath: snapshot.contentPath,
      maxBytes: 12 * 1024 * 1024
    });
    if (document.contentHash !== snapshot.contentHash) throw new Error('版本原文已被外部修改');
    if (snapshot.sourceId && (document.head.status !== 'ok' || document.head.frontmatter.id !== snapshot.sourceId))
      throw new Error('版本身份与原文不一致');
    return document.content;
  }
  async prune(rootPath: string, targetPath: string) {
    const lockPath = await resolveArtifactPath(rootPath, `${versionDirectory(targetPath)}/retention`);
    await withFileWriteLock(lockPath, async () => {
      const removable = (await this.list(rootPath, targetPath))
        .filter(snapshot => snapshot.reason !== 'final')
        .slice(20);
      for (const snapshot of removable) {
        for (const relativePath of [snapshot.contentPath, snapshot.contentPath.replace(/\.md$/, '.json')]) {
          await unlink(await resolveArtifactPath(rootPath, relativePath));
        }
      }
    });
  }
}
