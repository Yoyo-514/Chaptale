import type { ChatContextFile, SkillInvocation } from '@chaptale/shared';
import { parseSkillInvocation } from '@chaptale/shared';

import { decodeContextMessage } from './context';
import { decodeMemoryMessage } from './memory';
import { decodeSkillMessage } from './skill';

export type DecodedUserMessage = {
  /** 剥掉全部应用生成信封后的作者原文。 */
  text: string;
  /** 信封里恢复出的附件元数据。 */
  contextFiles: ChatContextFile[];
  skillInvocation?: SkillInvocation;
};

/**
 * 用户消息的信封总解码入口。
 *
 * 落盘形态是 `${memory}${context}${query}`（skill 调用时三者都在命令参数里），
 * 这些前缀只服务模型，**UI 展示、历史回放与导出都不该看到**——读回路径漏调解码器，
 * 历史里的每条用户消息就会带着完整注入块显示。
 *
 * 兼容两种 skill 形态：`<skill>` 展开信封与 `/skill:name` 紧凑命令。
 */
export function decodeUserMessage(raw: string): DecodedUserMessage {
  const legacySkill = decodeSkillMessage(raw);
  const compactSkill = legacySkill.skillInvocation ? undefined : parseSkillInvocation(raw);
  const body = legacySkill.skillInvocation ? legacySkill.text : (compactSkill?.arguments ?? raw);

  // 剥离次序必须与写入次序一致：记忆信封在最前，其后才是附件信封。
  const { text, contextFiles } = decodeContextMessage(decodeMemoryMessage(body).text);
  const skillName = legacySkill.skillInvocation?.name ?? compactSkill?.name;

  return {
    text,
    contextFiles,
    ...(skillName ? { skillInvocation: { name: skillName, arguments: text } } : {})
  };
}
