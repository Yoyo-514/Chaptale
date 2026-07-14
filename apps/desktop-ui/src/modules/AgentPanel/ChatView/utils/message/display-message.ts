import type { ChatContextFile, ChatImageAttachment, ChatMessage } from '@chaptale/shared';
import type { ChatDisplayMessage } from '../../types';
import { parseSkillSlashCommand } from '../slash-commands';

let messageSequence = 0;

export function createDisplayMessage(message: ChatMessage, prefix = 'message'): ChatDisplayMessage {
  messageSequence += 1;

  return {
    id: `${prefix}-${Date.now()}-${messageSequence}`,
    message
  };
}

function getPreviewImage(file: ChatContextFile): ChatImageAttachment | undefined {
  if (file.kind !== 'image' || !file.previewDataUrl || !file.mimeType) {
    return undefined;
  }

  return {
    type: 'imageAttachment',
    id: `selected:${file.path}`,
    mimeType: file.mimeType,
    originalBytes: file.size,
    width: file.imageWidth ?? 0,
    height: file.imageHeight ?? 0,
    thumbnailDataUrl: file.previewDataUrl,
    source: { type: 'context-file', path: file.path }
  };
}

export function createUserMessage(content: string, contextFiles: ChatContextFile[] = []): ChatMessage {
  const images: ChatImageAttachment[] = [];
  const displayFiles: ChatContextFile[] = [];
  const skillInvocation = parseSkillSlashCommand(content);
  const displayContent = skillInvocation?.arguments ?? content;

  for (const file of contextFiles) {
    const image = getPreviewImage(file);

    if (image) {
      images.push(image);
    } else {
      displayFiles.push(file);
    }
  }

  return {
    role: 'user',
    content:
      images.length > 0
        ? [...(displayContent ? [{ type: 'text' as const, text: displayContent }] : []), ...images]
        : displayContent,
    ...(displayFiles.length > 0 ? { contextFiles: displayFiles } : {}),
    ...(skillInvocation ? { skillInvocation } : {}),
    timestamp: Date.now()
  };
}

export function markUserMessageAsOptimisticBranch(displayMessage: ChatDisplayMessage) {
  const total = (displayMessage.branch?.total ?? 1) + 1;

  displayMessage.branch = {
    current: total,
    total,
    previousLeafId: displayMessage.branch?.previousLeafId,
    nextLeafId: undefined
  };
}
