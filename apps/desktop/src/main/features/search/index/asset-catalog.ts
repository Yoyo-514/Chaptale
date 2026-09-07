import { readFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  AssetRecordValidator,
  extractAssetLinks,
  resolveAssetLink,
  type AssetRecord,
  type AssetSnapshot
} from '@chaptale/shared';

import { toWorkspaceSessionDirName } from '../../../core/settings/workspace-session-directory';
import { WorkspaceLayoutService } from '../../../core/workspace/layout';
import { writeTextAtomically } from '../../../infra/filesystem/atomic-text';
import { readDocumentSnapshot } from '../../workspace/read-document';
import { discoverIndexSourceFiles } from './source-scanner';

type CatalogState = {
  assets: Map<string, AssetRecord>;
  stamps: Map<string, string>;
  identities: Record<string, string>;
};

/** 资产投影只解析变化的文件；关键词分词按需另行构建，不阻塞目录浏览。 */
export class AssetCatalog {
  private readonly states = new Map<string, CatalogState>();
  private readonly queues = new Map<string, Promise<AssetSnapshot>>();
  private readonly changed = new Map<string, Set<string>>();
  constructor(private readonly cacheRoot: string) {}

  invalidate(cwd: string, paths?: readonly string[]) {
    const changed = this.changed.get(cwd) ?? new Set<string>();
    for (const source of paths ?? ['*']) changed.add(source);
    this.changed.set(cwd, changed);
  }

  async resolveLink(cwd: string, link: string) {
    const snapshot = await this.list(cwd);
    return resolveAssetLink(link, snapshot.assets, this.states.get(cwd)?.identities);
  }

  list(cwd: string): Promise<AssetSnapshot> {
    const prior = this.queues.get(cwd);
    const result = (prior?.catch(() => undefined) ?? Promise.resolve()).then(() => this.scan(cwd));
    this.queues.set(cwd, result);
    void result
      .finally(() => {
        if (this.queues.get(cwd) === result) this.queues.delete(cwd);
      })
      .catch(() => undefined);
    return result;
  }

  private async scan(cwd: string): Promise<AssetSnapshot> {
    const layout = await new WorkspaceLayoutService().read(cwd);
    const scanned = await discoverIndexSourceFiles({
      cwd,
      roots: [
        { absolutePath: cwd, domain: 'canon', role: 'world' },
        { absolutePath: path.join(cwd, '.chaptale/memory/notes'), domain: 'notes', role: 'notes' },
        { absolutePath: path.join(cwd, '.chaptale/memory/summaries'), domain: 'summaries', role: 'summaries' }
      ]
    });
    const cachePath = path.join(this.cacheRoot, toWorkspaceSessionDirName(cwd), 'index/assets.json');
    let state = this.states.get(cwd);
    if (!state) {
      state = { assets: new Map(), stamps: new Map(), identities: {} };
      try {
        if ((await stat(cachePath)).size > 32 * 1024 * 1024) throw new Error('资产缓存过大');
        const cached = JSON.parse(await readFile(cachePath, 'utf8')) as { assets?: unknown[]; identities?: unknown };
        for (const asset of Array.isArray(cached.assets) ? cached.assets : []) {
          if (AssetRecordValidator.Check(asset)) state.assets.set(asset.sourcePath, asset);
        }
        if (cached.identities && typeof cached.identities === 'object') {
          for (const [key, id] of Object.entries(cached.identities)) {
            if (typeof id === 'string') state.identities[key] = id;
          }
        }
      } catch {
        /* 可重建缓存不阻止扫描。 */
      }
      this.states.set(cwd, state);
    }
    const dirty = this.changed.get(cwd) ?? new Set<string>();
    this.changed.delete(cwd);
    const diagnostics: AssetSnapshot['diagnostics'] = [
      ...scanned.diagnostics,
      ...layout.diagnostics.map(message => ({ code: 'layout', message }))
    ];
    const present = new Set(scanned.files.map(file => file.sourcePath));
    for (const source of state.assets.keys()) {
      if (!present.has(source)) {
        state.assets.delete(source);
        state.stamps.delete(source);
      }
    }
    const rolePaths = Object.entries(layout.roles).toSorted(
      (a, b) => b[1].relativePath.length - a[1].relativePath.length
    );
    const currentState = state;
    for (let start = 0; start < scanned.files.length; start += 8) {
      await Promise.all(
        scanned.files.slice(start, start + 8).map(async file => {
          const role =
            file.domain !== 'canon'
              ? file.domain
              : (rolePaths.find(([, value]) => file.sourcePath.startsWith(`${value.relativePath}/`))?.[0] ??
                'inspiration');
          const stamp = `${file.size}:${file.mtimeMs}:${role}`;
          if (currentState.stamps.get(file.sourcePath) === stamp && !dirty.has('*') && !dirty.has(file.sourcePath))
            return;
          try {
            const document = await readDocumentSnapshot({
              rootPath: cwd,
              relativePath: file.sourcePath,
              maxBytes: 8 * 1024 * 1024
            });
            const frontmatter = document.head.status === 'ok' ? document.head.frontmatter : {};
            const stringField = (key: string) =>
              typeof frontmatter[key] === 'string' ? (frontmatter[key] as string) : undefined;
            const id = stringField('id');
            const asset: AssetRecord = {
              sourcePath: file.sourcePath,
              ...(id ? { id } : {}),
              role: role as AssetRecord['role'],
              title: stringField('title') ?? path.basename(file.sourcePath, '.md'),
              ...(stringField('kind') ? { kind: stringField('kind') } : {}),
              ...(stringField('status') ? { status: stringField('status') } : {}),
              aliases: Array.isArray(frontmatter.aliases)
                ? frontmatter.aliases.filter((value): value is string => typeof value === 'string')
                : [],
              frontmatter,
              contentHash: document.contentHash,
              updatedAt: new Date(document.mtimeMs).toISOString(),
              sizeBytes: document.sizeBytes,
              chars: document.head.body.length,
              excerpt: document.head.body
                .replace(/^#+\s+/gm, '')
                .trim()
                .slice(0, 220),
              links: extractAssetLinks(document.content).map(link => ({ link, status: 'missing', candidates: [] })),
              backlinks: [],
              ...(document.head.status === 'invalid' ? { diagnostic: document.head.error } : {})
            };
            currentState.assets.set(file.sourcePath, asset);
            currentState.stamps.set(file.sourcePath, stamp);
          } catch (error) {
            currentState.assets.delete(file.sourcePath);
            currentState.stamps.delete(file.sourcePath);
            diagnostics.push({ code: 'asset-read-failed', sourcePath: file.sourcePath, message: String(error) });
          }
        })
      );
    }
    const assets = [...state.assets.values()]
      .map(asset => Object.assign({}, asset))
      .toSorted((a, b) => a.sourcePath.localeCompare(b.sourcePath, 'zh-CN', { numeric: true }));
    const idCounts = new Map<string, number>();
    for (const asset of assets) if (asset.id) idCounts.set(asset.id, (idCounts.get(asset.id) ?? 0) + 1);
    for (const asset of assets) {
      if (asset.id && idCounts.get(asset.id) === 1) {
        state.identities[asset.sourcePath.normalize('NFC').toLowerCase().replace(/\.md$/i, '')] = asset.id;
      } else if (asset.id)
        diagnostics.push({ code: 'duplicate-id', sourcePath: asset.sourcePath, message: `重复资产 id：${asset.id}` });
    }
    for (const asset of assets) {
      asset.backlinks = [];
      asset.links = asset.links.map(link => resolveAssetLink(link.link, assets, state.identities));
    }
    const byPath = new Map(assets.map(asset => [asset.sourcePath, asset]));
    for (const asset of assets)
      for (const link of asset.links) {
        const target = link.targetPath ? byPath.get(link.targetPath) : undefined;
        if (target && !target.backlinks.includes(asset.sourcePath)) target.backlinks.push(asset.sourcePath);
      }
    try {
      await mkdir(path.dirname(cachePath), { recursive: true });
      await writeTextAtomically(cachePath, JSON.stringify({ assets, identities: state.identities }));
    } catch (error) {
      diagnostics.push({ code: 'asset-cache-failed', message: String(error) });
    }
    return { rootPath: cwd, assets, diagnostics };
  }
}
