import path from 'node:path';

/** 作者级 memory 目录布局（~/.chaptale/memory，跨作品）。 */
export type AuthorMemoryPaths = {
  root: string;
  /** 手工索引（条目少且稳定，保留手工维护）。 */
  memoryIndex: string;
  /** 语言风格、通用禁忌（kind: preference）。 */
  preferencesDir: string;
  /** 对 agent 行为的纠正沉淀。 */
  feedbackDir: string;
};

/** 作品级 memory 目录布局（<workspace>/.chaptale/memory）。 */
export type WorkspaceMemoryPaths = {
  root: string;
  /** agent 观察区（可直写；kind: note + source 追溯）。 */
  notesDir: string;
  /** 修改提议（MC1 起使用，目录约定先行）。 */
  pendingDir: string;
  summariesDir: string;
  chapterSummariesDir: string;
  /** 滚动近况（纯代码拼接，MC4 生成；MC0 只读）。 */
  recent: string;
  /** 作品级创作守则（作者领地，非 .chaptale 内）。 */
  styleGuide: string;
};

export function resolveAuthorMemoryPaths(chaptaleRootDir: string): AuthorMemoryPaths {
  const root = path.join(chaptaleRootDir, 'memory');
  return {
    root,
    memoryIndex: path.join(root, 'MEMORY.md'),
    preferencesDir: path.join(root, 'preferences'),
    feedbackDir: path.join(root, 'feedback')
  };
}

export function resolveWorkspaceMemoryPaths(cwd: string): WorkspaceMemoryPaths {
  const root = path.join(cwd, '.chaptale', 'memory');
  const summariesDir = path.join(root, 'summaries');
  return {
    root,
    notesDir: path.join(root, 'notes'),
    pendingDir: path.join(root, 'pending'),
    summariesDir,
    chapterSummariesDir: path.join(summariesDir, 'chapters'),
    recent: path.join(summariesDir, 'recent.md'),
    styleGuide: path.join(cwd, '设定', '创作守则.md')
  };
}
