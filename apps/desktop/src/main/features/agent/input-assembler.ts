import type { ChatMessage, ChatTextPart, ChatUserContent, SkillInvocation } from '@chaptale/shared';
import { formatSkillInvocation, parseSkillInvocation } from '@chaptale/shared';

import type { ImageAttachmentService } from '../../core/attachments/service';
import type { ContextFileService } from '../../core/context/service';
import { decodeContextMessage } from '../../core/prompt-envelope/context';
import type { SessionImagePart, SessionMessage } from '../../core/sessions/entry';

export type UserChatMessage = Extract<ChatMessage, { role: 'user' }>;
export type UserSessionMessage = Extract<SessionMessage, { role: 'user' }>;

export type AssembledUserInput = {
  /** 落盘条目：memory/context 信封 + 内联图片，模型回放看到的完整形态。 */
  entry: UserSessionMessage;
  /**
   * UI 回显构造器。
   *
   * 必须在 entry 落盘之后调用：图片附件的 source 要指向真实 entryId，
   * readSessionImage 据此回读原图。source 为空时点开原图必然抛
   * 「找不到图片所属的会话消息」。
   */
  createEcho: (entryId: string) => UserChatMessage;
};

export type InputAssemblerDeps = {
  /** 缺省时不解析附件，退化为纯文本输入。 */
  contextFileService?: Pick<ContextFileService, 'resolve'>;
  /** 缺省时图片不回显缩略图（仍然落盘并进模型上下文）。 */
  imageAttachmentService?: Pick<ImageAttachmentService, 'createPresentation'>;
};

/**
 * 用户输入组装：附件解析 + 信封拼装 + skill 展开 + 回显投影。
 *
 * 首轮与 steer 轮共用同一条路径——两者的差异只有「谁来调」，任何形态差异都是 bug。
 * 复用历史条目（reuseUserEntryId）不走这里：不重解析、不重落盘、不重回显。
 */
export class InputAssembler {
  constructor(private readonly deps: InputAssemblerDeps) {}

  async assemble(input: {
    sessionId: string;
    query: string;
    contextFilePaths?: string[];
    /** 记忆注入前缀（含尾随空行）；空串表示本轮不注入。 */
    memoryPrefix?: string;
    signal?: AbortSignal;
  }): Promise<AssembledUserInput> {
    const memoryPrefix = input.memoryPrefix ?? '';
    const skillInvocation = parseSkillInvocation(input.query);
    const resolved =
      this.deps.contextFileService && input.contextFilePaths?.length
        ? await this.deps.contextFileService.resolve(input.contextFilePaths, {
            query: input.query,
            signal: input.signal
          })
        : undefined;

    const contextPrefix = resolved?.promptPrefix ?? '';
    const { contextFiles } = decodeContextMessage(contextPrefix);
    // 记忆信封排在最前：它是变化频率最低的前缀，有利于 provider 前缀缓存。
    const promptPrefix = `${memoryPrefix}${contextPrefix}`;
    const promptText = buildPromptText(promptPrefix, input.query, skillInvocation);
    const imageParts: SessionImagePart[] = (resolved?.images ?? []).map(image => ({
      type: 'image',
      data: image.data,
      mimeType: image.mimeType
    }));

    const entry: UserSessionMessage = {
      role: 'user',
      content: imageParts.length > 0 ? [{ type: 'text', text: promptText }, ...imageParts] : promptText,
      ...(contextFiles.length > 0 ? { contextFiles } : {})
    };
    const displayText = skillInvocation?.arguments ?? input.query;

    return {
      entry,
      createEcho: entryId => ({
        role: 'user',
        content: this.buildEchoContent(displayText, imageParts, input.sessionId, entryId),
        ...(contextFiles.length > 0 ? { contextFiles } : {}),
        ...(skillInvocation ? { skillInvocation } : {}),
        timestamp: Date.now()
      })
    };
  }

  private buildEchoContent(
    displayText: string,
    imageParts: SessionImagePart[],
    sessionId: string,
    entryId: string
  ): ChatUserContent {
    if (imageParts.length === 0 || !this.deps.imageAttachmentService) {
      return displayText;
    }

    // blockIndex = 落盘 content 的真实下标：content 形如 [text, ...images]，图片从 1 起。
    const { attachments } = this.deps.imageAttachmentService.createPresentation(
      imageParts.map((image, index) => ({ ...image, blockIndex: index + 1 })),
      blockIndex => ({ type: 'session-entry', sessionId, entryId, blockIndex })
    );

    if (attachments.length === 0) {
      return displayText;
    }

    const textPart: ChatTextPart[] = displayText ? [{ type: 'text', text: displayText }] : [];
    return [...textPart, ...attachments];
  }
}

/**
 * skill 展开：`/skill:name` 必须留在行首，因此信封作为**命令参数**注入而非拼在命令之前。
 * 无 skill 调用时就是前缀 + 原文。
 */
function buildPromptText(promptPrefix: string, query: string, skillInvocation: SkillInvocation | undefined): string {
  if (!skillInvocation) {
    return `${promptPrefix}${query}`;
  }

  return formatSkillInvocation({
    ...skillInvocation,
    arguments: `${promptPrefix}${skillInvocation.arguments}`.trim()
  });
}
