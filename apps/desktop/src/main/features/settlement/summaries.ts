import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';

import { parseDocumentFrontmatter } from '@chaptale/shared/document-frontmatter';

import { resolveArtifactPath } from '../../core/workspace/artifacts';
import { writeTextAtomically } from '../../infra/filesystem/atomic-text';
import { withFileWriteLock } from '../../infra/filesystem/write-lock';
import { readDocumentSnapshot } from '../workspace/read-document';

export async function rebuildRecent(rootPath: string) {
  const directory = '.chaptale/memory/summaries';
  const filename = await resolveArtifactPath(rootPath, `${directory}/recent.md`);
  await withFileWriteLock(filename, async () => {
    const chaptersDirectory = await resolveArtifactPath(rootPath, `${directory}/chapters`);
    let names: string[];
    try {
      names = await readdir(chaptersDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      names = [];
    }
    const summaries: Array<{ key: string; order?: number; acceptedAt: string; title: string; content: string }> = [];
    for (const name of names.filter(value => /^[a-f0-9]{24}\.md$/.test(value))) {
      const relativePath = `${directory}/chapters/${name}`;
      await resolveArtifactPath(rootPath, relativePath);
      const document = await readDocumentSnapshot({ rootPath, relativePath, maxBytes: 256 * 1024 });
      const head = parseDocumentFrontmatter(document.content);
      if (head.status !== 'ok') throw new Error(`${name} 摘要元数据损坏，未重建 recent`);
      const metadata = head.frontmatter;
      if (metadata.kind !== 'chapter-summary' || typeof metadata.acceptedAt !== 'string') continue;
      summaries.push({
        key: name.slice(0, -3),
        ...(typeof metadata.order === 'number' ? { order: metadata.order } : {}),
        acceptedAt: metadata.acceptedAt,
        title: typeof metadata.title === 'string' ? metadata.title : name,
        content: head.body.trim()
      });
    }
    const byOrder = summaries.every(summary => summary.order !== undefined);
    const recent = summaries
      .toSorted((a, b) =>
        byOrder
          ? a.order! - b.order! || a.key.localeCompare(b.key)
          : a.acceptedAt.localeCompare(b.acceptedAt) || a.key.localeCompare(b.key)
      )
      .slice(-3);
    const content = `---\n${stringify({
      kind: 'summary',
      title: '最近三章摘要',
      orderBy: byOrder ? 'chapter-order' : 'acceptance-time',
      sources: recent.map(summary => `.chaptale/memory/summaries/chapters/${summary.key}.md`)
    })}---\n\n${recent.map(summary => `## ${summary.title.replaceAll('\n', ' ')}\n\n${summary.content}`).join('\n\n')}\n`;
    await mkdir(path.dirname(filename), { recursive: true });
    await resolveArtifactPath(rootPath, `${directory}/recent.md`);
    await writeTextAtomically(filename, content);
  });
}
