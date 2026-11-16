import { parseSkillBlock, type Skill } from '@earendil-works/pi-coding-agent';
import { readFile } from 'node:fs/promises';

import { decodePromptWithContext, encodePromptWithContext } from '../application/editor-context.ts';
import type { EditorContext, SkillInvocationView } from '../protocol.ts';

const commandPrefix = '/skill:';

function stripYamlFrontmatter(raw: string): string {
  const normalized = raw.replace(/\r\n/gu, '\n');
  if (!normalized.startsWith('---\n')) return normalized;
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    return normalized.endsWith('\n---') ? '' : normalized;
  }
  return normalized.slice(end + 5);
}

export function formatSkillCommand(name: string, args: string): string {
  const trimmed = args.trim();
  return trimmed ? `${commandPrefix}${name} ${trimmed}` : `${commandPrefix}${name}`;
}

/**
 * 展开作者输入的 `/skill:<name> [args]`（仅对当前会话已启用技能生效），再包裹可选的 `<editor_context>`。
 * 统一使用 LF 换行并与 pi 原生 `parseSkillBlock` 格式严格对齐。
 */
export async function encodeUserPrompt(
  text: string,
  context: EditorContext | undefined,
  sessionWorkId: string | null,
  enabledSkills: readonly Skill[]
): Promise<string> {
  let bodyText = text;
  if (text.startsWith(commandPrefix)) {
    const spaceIndex = text.indexOf(' ');
    const skillName =
      spaceIndex === -1 ? text.slice(commandPrefix.length) : text.slice(commandPrefix.length, spaceIndex);
    const args = spaceIndex === -1 ? '' : text.slice(spaceIndex + 1).trim();
    const skill = enabledSkills.find(item => item.name === skillName);
    if (skill) {
      const content = await readFile(skill.filePath, 'utf8');
      const body = stripYamlFrontmatter(content).trim();
      const baseDir = skill.baseDir.replace(/\\/gu, '/');
      const filePath = skill.filePath.replace(/\\/gu, '/');
      const block = `<skill name="${skill.name}" location="${filePath}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`;
      bodyText = args ? `${block}\n\n${args}` : block;
    }
  }
  return encodePromptWithContext(bodyText, context, sessionWorkId);
}

/** 逆向拆分 `<editor_context>` 与 `<skill ...>` 块，供聊天气泡与排队撤回无损还原。 */
export function decodeUserPrompt(raw: string): {
  text: string;
  editorContext?: EditorContext;
  skill?: SkillInvocationView;
} {
  const { text, editorContext } = decodePromptWithContext(raw);
  const parsed = parseSkillBlock(text);
  if (!parsed) {
    return { text, ...(editorContext && { editorContext }) };
  }
  return {
    text: parsed.userMessage ?? '',
    skill: { name: parsed.name },
    ...(editorContext && { editorContext })
  };
}
