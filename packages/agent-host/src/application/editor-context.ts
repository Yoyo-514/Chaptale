import type { EditorContext } from '../protocol.ts';

const prefix = '<editor_context>\n';
const suffix = '\n</editor_context>\n\n';

/** 将当前打开标签定位与框选原文作为前缀拼入发给 pi 的原生用户消息；展示时无损拆分回原文与选区。 */
export function encodePromptWithContext(
  text: string,
  context: EditorContext | undefined,
  sessionWorkId: string | null
): string {
  if (!context) return text;
  const kind = context.section === 'resource' ? '资料' : '文稿';
  const work = sessionWorkId === context.workId ? '' : `，workId: ${context.workId}`;
  const header = `当前打开：${kind}《${context.title}》（entryId: ${context.entryId}${work}）`;
  const payload = JSON.stringify(context);
  const selection = context.selection ? `\n选中原文：\n${context.selection}` : '';
  return `${prefix}<!--${payload}-->\n${header}${selection}${suffix}${text}`;
}

export function decodePromptWithContext(raw: string): { text: string; editorContext?: EditorContext } {
  if (!raw.startsWith(prefix)) return { text: raw };
  const end = raw.indexOf(suffix, prefix.length);
  if (end === -1) return { text: raw };
  const block = raw.slice(prefix.length, end);
  const commentEnd = block.indexOf('-->\n');
  if (!block.startsWith('<!--') || commentEnd === -1) return { text: raw };
  const editorContext = JSON.parse(block.slice(4, commentEnd)) as EditorContext;
  return { text: raw.slice(end + suffix.length), editorContext };
}
