import { describe, expect, it } from 'vitest';

import type { ChatContextFile, ChatMessage } from '@chaptale/shared';

import { createChatState } from '../../composables/chat-state';
import { usePendingUserMessages } from '../../composables/usePendingUserMessages';

/** 从测试用户消息中提取纯文本，非用户消息视为测试错误。 */
function getUserText(message: ChatMessage): string {
  if (message.role !== 'user') {
    throw new Error('预期为用户消息');
  }

  return typeof message.content === 'string'
    ? message.content
    : (message.content.find(block => block.type === 'text')?.text ?? '');
}

describe('usePendingUserMessages', () => {
  it('按 FIFO 用规范 user message 替换普通消息和连续 steer', () => {
    const state = createChatState();
    const pending = usePendingUserMessages(state);
    pending.enqueue('prompt', '初始问题', []);
    const firstSteer = pending.enqueue('steer', '第一条调整', []);
    const secondSteer = pending.enqueue('steer', '第二条调整', []);
    pending.markQueued(firstSteer.id);
    pending.markQueued(secondSteer.id);

    pending.resolveNext({ role: 'user', content: '初始问题', timestamp: 1 });
    pending.resolveNext({ role: 'user', content: '第一条调整', timestamp: 2 });

    expect(state.messages[0]?.message.timestamp).toBe(1);
    expect(state.messages[1]?.message.timestamp).toBe(2);
    expect(state.messages[1]?.deliveryState).toBeUndefined();
    expect(state.messages[2]?.deliveryState).toBe('queued');
  });

  it('保留乐观附件展示，并采用规范 user event 的时间戳', () => {
    const state = createChatState();
    const pending = usePendingUserMessages(state);
    pending.enqueue('steer', '检查封面', [
      {
        path: 'C:/novel/cover.png',
        name: 'cover.png',
        size: 3,
        kind: 'image',
        mimeType: 'image/png',
        previewDataUrl: 'data:image/png;base64,YWJj'
      }
    ]);

    pending.resolveNext({ role: 'user', content: '检查封面', timestamp: 123 });

    expect(state.messages[0]?.message).toMatchObject({
      role: 'user',
      timestamp: 123,
      content: [
        { type: 'text', text: '检查封面' },
        { type: 'imageAttachment', source: { type: 'context-file', path: 'C:/novel/cover.png' } }
      ]
    });
  });

  it('只取出仍待处理的 steer 尾部记录', () => {
    const state = createChatState();
    const pending = usePendingUserMessages(state);
    const first = pending.enqueue('steer', 'A', []);
    const second = pending.enqueue('steer', 'B', []);
    const third = pending.enqueue('steer', 'C', []);
    pending.markQueued(first.id);
    pending.markQueued(second.id);
    pending.markQueued(third.id);

    const restored = pending.takeQueuedSteersFromTail(2);

    expect(restored.map(item => item.query)).toEqual(['B', 'C']);
    expect(state.messages.map(item => getUserText(item.message))).toEqual(['A']);
  });

  it('终态清理移除未交付 steer，并保留已交付 prompt 的消息', () => {
    const state = createChatState();
    const pending = usePendingUserMessages(state);
    pending.enqueue('prompt', '初始问题', []);
    const queuedSteer = pending.enqueue('steer', '未交付调整', []);
    pending.markQueued(queuedSteer.id);
    pending.enqueue('steer', '提交中调整', []);

    pending.clear();

    expect(state.messages.map(item => getUserText(item.message))).toEqual(['初始问题']);
    expect(state.messages[0]?.deliveryState).toBeUndefined();
  });

  it('回滚临时消息并保留上下文文件快照', () => {
    const state = createChatState();
    const pending = usePendingUserMessages(state);
    const contextFiles: ChatContextFile[] = [
      { path: 'C:/novel/outline.md', name: 'outline.md', size: 2048, kind: 'text' }
    ];
    const submission = pending.enqueue('steer', '检查大纲', contextFiles);

    contextFiles[0]!.name = 'changed.md';
    expect(submission.contextFiles[0]?.name).toBe('outline.md');

    pending.rollback(submission.id);
    expect(state.messages).toEqual([]);
  });
});
