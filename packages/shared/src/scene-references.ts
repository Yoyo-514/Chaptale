import { extractAssetLinks, resolveAssetLink, type AssetRecord, type ReferenceSelection } from './library';

export type SceneReferences = {
  scenePath: string;
  chapterPath?: string;
  goal: string;
  selections: ReferenceSelection[];
  diagnostics: string[];
};
function links(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
  if (typeof value !== 'string' || !value.trim()) return [];
  const found = extractAssetLinks(value);
  return found.length ? found : [value];
}
function isChapter(asset: AssetRecord | undefined) {
  return asset?.kind === 'chapter' || (asset?.role === 'manuscript' && !asset.kind);
}
export function selectSceneReferences(
  scene: AssetRecord,
  assets: readonly AssetRecord[],
  previous: readonly ReferenceSelection[] = [],
  excluded: readonly string[] = []
): SceneReferences {
  if (scene.kind !== 'scene-card' || scene.status === 'archived') throw new Error('请选择有效场景卡');
  const available = assets.filter(asset => asset.status !== 'archived' && asset.role !== 'templates');
  const byPath = new Map(available.map(asset => [asset.sourcePath, asset]));
  const selections: ReferenceSelection[] = [];
  const diagnostics: string[] = [];
  const pinned = previous.filter(selection => selection.pinned);
  const pinnedPaths = new Set(pinned.map(selection => selection.sourcePath));
  const selectedPaths = new Set<string>();
  const add = (asset: AssetRecord, reason: string, mode: ReferenceSelection['mode'] = 'full') => {
    if (selectedPaths.has(asset.sourcePath) || pinnedPaths.has(asset.sourcePath) || excluded.includes(asset.sourcePath))
      return;
    const old = previous.find(selection => selection.sourcePath === asset.sourcePath);
    selections.push({ sourcePath: asset.sourcePath, pinned: false, mode: old?.mode ?? mode, reason });
    selectedPaths.add(asset.sourcePath);
  };
  const resolve = (link: string, owner = scene) => {
    const resolved = owner.links.find(item => item.link === link) ?? resolveAssetLink(link, available);
    const asset = resolved.targetPath ? byPath.get(resolved.targetPath) : undefined;
    if (!asset) diagnostics.push(`${link}：${resolved.status === 'ambiguous' ? '存在多个同名来源' : '来源不可用'}`);
    return asset;
  };
  add(scene, '场景目标与边界');
  const chapterLink = links(scene.frontmatter.chapter)[0];
  const resolvedChapter = chapterLink ? resolve(chapterLink) : undefined;
  const chapter = isChapter(resolvedChapter) ? resolvedChapter : undefined;
  if (resolvedChapter && !chapter) diagnostics.push(`${chapterLink}：不是章节`);
  const order = typeof chapter?.frontmatter.order === 'number' ? chapter.frontmatter.order : undefined;
  for (const link of links(scene.frontmatter.cast)) {
    const character = resolve(link);
    if (character?.kind === 'character') add(character, '出场角色状态', 'summary');
    else if (character) diagnostics.push(`${link}：不是角色卡`);
  }
  for (const link of links(scene.frontmatter.threads)) {
    const thread = resolve(link);
    if (thread?.kind === 'plot-thread') add(thread, '场景指定伏笔');
    else if (thread) diagnostics.push(`${link}：不是伏笔线`);
  }
  // 顺序由稳定路径确定；日期和文件更新时间不参与情节先后判断。
  // oxlint-disable-next-line unicorn/no-array-sort
  const ordered = [...available].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath, 'zh-CN'));
  for (const thread of ordered.filter(
    asset => asset.kind === 'plot-thread' && ['planted', 'advanced'].includes(asset.status ?? '')
  )) {
    if (selectedPaths.has(thread.sourcePath) || pinnedPaths.has(thread.sourcePath)) continue;
    const plantedLink = links(thread.frontmatter.plantedAt)[0];
    const planted = plantedLink ? resolve(plantedLink, thread) : undefined;
    const plantedOrder =
      planted && isChapter(planted) && typeof planted.frontmatter.order === 'number'
        ? planted.frontmatter.order
        : undefined;
    if (order !== undefined && plantedOrder !== undefined && plantedOrder <= order) add(thread, '本章已埋设的活跃伏笔');
    else if (order === undefined || plantedOrder === undefined)
      diagnostics.push(`${thread.title}：章序不明，未自动采用`);
  }
  for (const link of [...links(scene.frontmatter.location), ...scene.links.map(item => item.link)]) {
    const resolved = scene.links.find(item => item.link === link) ?? resolveAssetLink(link, available);
    const asset = resolved.targetPath ? byPath.get(resolved.targetPath) : undefined;
    if (asset?.kind === 'world') add(asset, '地点与场景设定');
  }
  const recent = byPath.get('.chaptale/memory/summaries/recent.md');
  if (recent) add(recent, '最近三章摘要');
  for (const asset of ordered.filter(value => value.kind === 'style')) add(asset, '创作守则', 'summary');
  for (const selection of pinned) {
    if (selections.some(value => value.sourcePath === selection.sourcePath)) continue;
    selections.push({ ...selection });
    if (!byPath.has(selection.sourcePath)) diagnostics.push(`${selection.sourcePath}：固定来源不可用，未自动替换`);
  }
  return {
    scenePath: scene.sourcePath,
    ...(chapter ? { chapterPath: chapter.sourcePath } : {}),
    goal: typeof scene.frontmatter.goal === 'string' ? scene.frontmatter.goal : scene.title,
    selections,
    diagnostics: [...new Set(diagnostics)]
  };
}
