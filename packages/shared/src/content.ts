import type { PersonaFrontmatter } from './personas';

export type ContentKind = 'persona' | 'skill' | 'template';
export type ContentScope = 'user' | 'workspace';
export type ContentSource = ContentScope | 'builtin';
export type ContentRef = {
  kind: ContentKind;
  id: string;
  source: ContentSource;
  sourcePath: string;
  hash: string;
};
export type ContentEntry = ContentRef & {
  name: string;
  effective: boolean;
  persona?: PersonaFrontmatter;
};
export type ContentList = { entries: ContentEntry[]; diagnostics: string[] };
export type ContentDocument = ContentEntry & { markdown: string };
export type ContentImportEntry = {
  kind: ContentKind;
  id: string;
  name: string;
  markdown: string;
  warnings: string[];
  conflict?: ContentRef;
};
export type ContentImportPreview = { entries: ContentImportEntry[] };

export const CONTENT_TOOLS = [
  { id: 'memory_search', label: '作品记忆检索' },
  { id: 'skill_read', label: '按需读取技能' },
  { id: 'read', label: '读取作品文件' },
  { id: 'grep', label: '搜索作品文本' },
  { id: 'find', label: '查找作品文件' },
  { id: 'ls', label: '列出作品目录' },
  { id: 'write', label: '创建与写入文件（需授权）' },
  { id: 'edit', label: '编辑文件（需授权）' },
  { id: 'web_search', label: '联网搜索（需授权）' },
  { id: 'fetch_content', label: '提取网页（需授权）' },
  { id: 'get_search_content', label: '读取搜索结果' },
  { id: 'todo_write', label: '创作待办' },
  { id: 'delegate', label: '委派专员任务' },
  { id: 'memory_save', label: '保存观察' },
  { id: 'memory_propose', label: '提出事实变更' }
] as const;
export const CONTENT_MEMORY_DOMAINS = [
  { id: 'canon', label: '已确认设定与正文' },
  { id: 'summaries', label: '情节摘要' },
  { id: 'notes', label: '待确认观察' },
  { id: 'author', label: '跨作品作者偏好' }
] as const;
