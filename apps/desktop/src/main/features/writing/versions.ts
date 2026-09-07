import { createHash, randomUUID } from 'node:crypto';
import { readdir, unlink } from 'node:fs/promises';

import type { WorkspaceDocument } from '@chaptale/ipc-contract';
import { VersionSnapshotValidator, type VersionSnapshot } from '@chaptale/shared';

import { createArtifact, resolveArtifactPath } from '../../core/workspace/artifacts';
import { withFileWriteLock } from '../../infra/filesystem/write-lock';
import { readDocumentSnapshot } from '../workspace/read-document';

function versionDirectory(targetPath: string) {
  return `.chaptale/revisions/versions/${createHash('sha256').update(targetPath).digest('hex').slice(0, 24)}`;
}
export class VersionStore {
  async save(document: WorkspaceDocument, reason: VersionSnapshot['reason'], candidateId?: string) {
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
      ...(candidateId ? { candidateId } : {})
    };
    await createArtifact(document.rootPath, contentPath, document.content);
    await createArtifact(document.rootPath, `${directory}/${id}.json`, JSON.stringify(snapshot));
    await this.prune(document.rootPath, document.relativePath);
    return snapshot;
  }
  async list(rootPath: string, targetPath: string) {
    const directory = versionDirectory(targetPath);
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
        snapshot.targetPath !== targetPath ||
        snapshot.id !== name.slice(0, -5) ||
        snapshot.contentPath !== `${directory}/${snapshot.id}.md`
      ) {
        throw new Error(`版本记录损坏：${name}`);
      }
      snapshots.push(snapshot);
    }
    return snapshots.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async read(rootPath: string, targetPath: string, snapshotId: string) {
    const snapshot = (await this.list(rootPath, targetPath)).find(value => value.id === snapshotId);
    if (!snapshot) throw new Error('版本不存在');
    await resolveArtifactPath(rootPath, snapshot.contentPath);
    const document = await readDocumentSnapshot({
      rootPath,
      relativePath: snapshot.contentPath,
      maxBytes: 12 * 1024 * 1024
    });
    if (document.contentHash !== snapshot.contentHash) throw new Error('版本原文已被外部修改');
    return { snapshot, content: document.content };
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
