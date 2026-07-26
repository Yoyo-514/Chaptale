import type { ImageContent } from '@earendil-works/pi-ai/compat';

import type { AgentRunOptions } from '@chaptale/ipc-contract';
import type { ChatMessage, SkillInvocation } from '@chaptale/shared';
import { formatSkillInvocation, parseSkillInvocation } from '@chaptale/shared';

import type { ImageAttachmentService } from '../../../core/attachments/service';
import { decodeContextMessage } from '../../../core/context/context-message-codec';
import type { ContextFileService } from '../../../core/context/service';
import { decodeMemoryMessage } from '../../../modules/memory/message-codec';

/** 普通 prompt 与 steer 共享的文本、会话和附件输入。 */
export type AgentInputOptions = Pick<AgentRunOptions, 'query' | 'sessionId' | 'contextFilePaths' | 'reuseUserEntryId'>;

export type ReusedUserEntryContext = {
  promptPrefix: string;
  imageBlocks: Array<{ type: 'image'; data: string; mimeType: string; blockIndex: number }>;
};

export type AgentRunContext = {
  userMessage: ChatMessage;
  promptText: string;
  promptImages: ImageContent[];
};

export type InputAssemblerDeps = {
  contextFileService: Pick<ContextFileService, 'resolve'>;
  imageAttachmentService: Pick<ImageAttachmentService, 'createPresentation'>;
};

/** 解析上下文文件与图片附件，产出用户消息、最终 prompt 文本与随行图片。 */
export class InputAssembler {
  constructor(private readonly deps: InputAssemblerDeps) {}

  async assemble(input: {
    options: AgentInputOptions;
    memoryPrefix?: string;
    skillInvocation?: SkillInvocation;
    reusedContext?: ReusedUserEntryContext;
  }): Promise<AgentRunContext> {
    const { options, reusedContext, memoryPrefix = '' } = input;
    const skillInvocation = input.skillInvocation ?? parseSkillInvocation(options.query);
    const resolvedContext = reusedContext
      ? undefined
      : await this.deps.contextFileService.resolve(options.contextFilePaths);
    // 上下文信封单独解码（其正则锚定行首）；复用的历史前缀可能自带 memory 信封，先剔除再解。
    const contextPrefix = reusedContext?.promptPrefix ?? resolvedContext!.promptPrefix;
    const decodedContext = decodeContextMessage(decodeMemoryMessage(contextPrefix).text);
    // 记忆信封排在最前：它是变化频率最低的前缀，有利于 provider 前缀缓存。
    const promptPrefix = `${memoryPrefix}${contextPrefix}`;
    // 复用历史消息时保留原始 content 下标，保证 session-entry source 与 readOriginal 对齐；
    // 新发送时 pi 会把消息持久化为 [text, ...images]，图片真实下标从 1 开始。
    const imageBlocks = reusedContext
      ? reusedContext.imageBlocks
      : (resolvedContext?.images ?? []).map((image, index) => ({
          type: image.type,
          data: image.data,
          mimeType: image.mimeType,
          blockIndex: index + 1
        }));
    const promptImages = imageBlocks.map(image => ({
      type: image.type,
      data: image.data,
      mimeType: image.mimeType
    }));
    const imagePaths = resolvedContext?.imagePaths ?? [];
    const presentation = this.deps.imageAttachmentService.createPresentation(imageBlocks, blockIndex => {
      if (options.reuseUserEntryId) {
        return {
          type: 'session-entry',
          sessionId: options.sessionId,
          entryId: options.reuseUserEntryId,
          blockIndex
        };
      }

      const imagePath = imagePaths[blockIndex - 1];
      return imagePath ? { type: 'context-file', path: imagePath } : undefined;
    });
    const displayText = skillInvocation?.arguments ?? options.query;
    const userContent =
      presentation.attachments.length > 0
        ? [...(displayText ? [{ type: 'text' as const, text: displayText }] : []), ...presentation.attachments]
        : displayText;

    // pi 只在文本以 /skill: 开头时执行原生展开；附件信封因此作为命令参数注入，而不是放在命令前。
    const promptText = skillInvocation
      ? formatSkillInvocation({
          ...skillInvocation,
          arguments: `${promptPrefix}${skillInvocation.arguments}`.trim()
        })
      : `${promptPrefix}${options.query}`;

    return {
      userMessage: {
        role: 'user',
        content: userContent,
        ...(decodedContext.contextFiles.length > 0 ? { contextFiles: decodedContext.contextFiles } : {}),
        ...(skillInvocation ? { skillInvocation } : {}),
        timestamp: Date.now()
      },
      promptText,
      promptImages
    };
  }
}
