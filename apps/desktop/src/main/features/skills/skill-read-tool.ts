import { opendir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Type } from 'typebox';

import { takeTextToTokenBudget } from '../../core/context/token-counter';
import type { ToolDefinition } from '../../core/tool-protocol/definition';
import { TOOL_RESULT_TOKEN_BUDGET } from '../../core/tool-protocol/model-output';
import { readManagedText, resolveManagedPath } from '../../infra/filesystem/managed-text';
import type { SkillProvider } from './provider-port';

export const SKILL_READ_TOOL_NAME = 'skill_read';

/** 目录清单最多列出的辅助文件数：防超大目录把清单本身变成噪音。 */
const MAX_LISTED_FILES = 30;
const MAX_SCANNED_ENTRIES = 300;
const MAX_DIRECTORY_DEPTH = 4;

/**
 * 技能文本的自限预算，留在工具结果预算之下。
 *
 * 工具结果预算的截断形态是保留首尾、省略中间——对流程文档这是最糟的形态，
 * 丢掉的正好是中间那几步。技能文本因此在这里先按**头部优先**截断，
 * 并明说"该拆成参考文件"：超长技能的失败方式既可读、也指得出修法。
 * 差额留给目录清单与提示行。
 */
const SKILL_TEXT_TOKEN_BUDGET = TOOL_RESULT_TOKEN_BUDGET - 1_000;

const skillReadParameters = Type.Object(
  {
    id: Type.String({ description: '技能短名（系统提示词技能清单中的名字）' }),
    path: Type.Optional(
      Type.String({
        description: '技能目录内的相对文件路径（如 references/xxx.md）；缺省返回 SKILL.md 并附目录内其他文件清单。'
      })
    )
  },
  { additionalProperties: false }
);

export type SkillReadToolOptions = {
  skillsProvider: Pick<SkillProvider, 'load'>;
  /**
   * 可用集收窄：
   * - chat 侧传 personaId（与注入同一份 appliesTo 过滤）；
   * - task 侧传 spec.skills 声明的白名单（不传 personaId，声明优先于 appliesTo）。
   * 缺省 = 全部可用（全局模式调试用）。
   */
  personaId?: string;
  allowedNames?: readonly string[];
  cwd: string;
};

/**
 * 技能文件的按需读取通道。
 *
 * read 工具被 resolveWithinCwd 限制在会话工作区内，而用户级与内置技能
 * 在 `~/.chaptale/` 下——不经本通道，模型永远读不到它们的正文。
 * 注入采用渐进披露（索引常驻、正文按需），模型用本工具取 SKILL.md 全文；
 * 目录型技能（SKILL.md 之外的辅助文件）经 path 参数读取，越界复用
 * managed-text 守卫（词法、真实路径、拒绝链接、128 KiB 字节上限和严格 UTF-8）。
 * 返回的 text 先按头部优先自限（见 SKILL_TEXT_TOKEN_BUDGET），再受工具结果预算兜底。
 */
export function createSkillReadTool(options: SkillReadToolOptions): ToolDefinition<typeof skillReadParameters> {
  const { skillsProvider, personaId, allowedNames, cwd } = options;

  return {
    name: SKILL_READ_TOOL_NAME,
    label: '读取技能',
    description:
      '读取技能文件：id + 缺省 path 返回 SKILL.md 全文（末尾附目录内其他文件清单）；path 指定技能目录内相对路径时返回该文件内容。可用技能清单在系统提示词末尾。',
    parameters: skillReadParameters,
    riskLevel: 'readonly',
    async execute(params) {
      const skill = await resolveSkill(params.id);

      if (!skill) {
        return {
          text: `没有名为「${params.id}」的可用技能。可用清单见系统提示词末尾的技能列表。`,
          details: { id: params.id }
        };
      }

      const skillDir = path.dirname(skill.filePath);

      if (params.path !== undefined) {
        return readSkillFile(skill, skillDir, params.path);
      }

      let body: string;
      try {
        body = await readManagedText(skillDir, path.basename(skill.filePath));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return { text: `技能「${skill.name}」文件已不存在：${skill.filePath}`, details: { id: skill.name } };
      }
      const listing = await listSkillFiles(skillDir);

      return {
        text:
          (fitSkillText(body.trim()) || `技能「${skill.name}」的正文为空：${skill.filePath}`) +
          (listing.length > 0
            ? `\n\n（本技能目录内还有以下文件，可用 skill_read 的 path 参数读取：\n${listing.join('\n')}）`
            : ''),
        details: { id: skill.name, description: skill.description }
      };
    }
  };

  async function resolveSkill(id: string) {
    const { skills } = await skillsProvider.load(cwd, personaId);
    const allowed = new Set(allowedNames ?? skills.map(skill => skill.name));

    return skills.find(candidate => candidate.name === id && allowed.has(candidate.name));
  }
}

/** 读取技能目录内的辅助文件；路径越界复用 read 的守卫（抛出，走 tool-error 通道）。 */
async function readSkillFile(
  skill: { name: string; filePath: string },
  skillDir: string,
  target: string
): Promise<{ text: string; details?: unknown }> {
  const filePath = await resolveManagedPath(skillDir, target);
  const info = await stat(filePath).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  });

  if (!info?.isFile()) {
    return { text: `技能「${skill.name}」目录内不存在文件：${target}` };
  }

  return { text: fitSkillText(await readManagedText(skillDir, target)) };
}

/**
 * 头部优先截断：超出部分整段丢弃，并告知余量与修法。
 *
 * 与工具结果预算的"保留首尾"相反，这里有意只留头——流程文档从前往后读才成立，
 * 中间被挖空会让模型跳过步骤而不自知。
 */
function fitSkillText(text: string): string {
  const { head, rest } = takeTextToTokenBudget(text, SKILL_TEXT_TOKEN_BUDGET);

  if (!rest) {
    return head;
  }

  return `${head}\n\n…（正文超出单次读取预算，此处截断；建议把该技能拆成目录内的参考文件，用 skill_read 的 path 参数分篇读取）`;
}

/** 流式扫描有深度与数量上限；只对已知全集报告精确余量。 */
async function listSkillFiles(skillDir: string): Promise<string[]> {
  const pending = [{ relative: '.', depth: 0 }];
  const files: string[] = [];
  let scanned = 0;
  let limited = false;
  while (pending.length > 0 && scanned < MAX_SCANNED_ENTRIES) {
    const current = pending.shift()!;
    const directory = await opendir(await resolveManagedPath(skillDir, current.relative));
    for await (const entry of directory) {
      if (scanned === MAX_SCANNED_ENTRIES) {
        limited = true;
        break;
      }
      scanned++;
      if (entry.isSymbolicLink()) continue;
      const relative = current.relative === '.' ? entry.name : `${current.relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (current.depth < MAX_DIRECTORY_DEPTH) pending.push({ relative, depth: current.depth + 1 });
        else limited = true;
      } else if (entry.isFile() && relative !== 'SKILL.md') {
        files.push(relative);
      }
    }
  }
  const listed = files.toSorted().slice(0, MAX_LISTED_FILES);
  if (limited || pending.length > 0) {
    return [...listed, '（清单已达到扫描数量或深度上限，未列全；已知路径仍可用 path 参数读取）'];
  }
  const rest = files.length - listed.length;
  return rest > 0 ? [...listed, `（还有 ${rest} 个文件未列出，可用 skill_read 的 path 参数直接读取）`] : listed;
}
