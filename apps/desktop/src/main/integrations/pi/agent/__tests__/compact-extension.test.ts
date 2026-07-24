import { describe, expect, it, vi } from 'vitest';

import { createCompactExt } from '../compact-extension';

function makeEvent(reason: 'manual' | 'threshold' | 'overflow') {
  const longToolResult = `正文开始-${'长'.repeat(2_500)}-正文结束`;

  return {
    type: 'session_before_compact' as const,
    reason,
    willRetry: reason === 'overflow',
    customInstructions: undefined,
    signal: new AbortController().signal,
    branchEntries: [],
    preparation: {
      firstKeptEntryId: 'entry-kept',
      tokensBefore: 72_000,
      previousSummary: '旧检查点',
      isSplitTurn: true,
      settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
      fileOps: { read: new Set(), written: new Set(), edited: new Set() },
      messagesToSummarize: [
        {
          role: 'user',
          content: [{ type: 'text', text: '<memory>\n旧 memory 快照\n</memory>\n\n继续第三章' }],
          timestamp: 1
        },
        { role: 'assistant', content: [{ type: 'text', text: '已经完成入口段落' }], timestamp: 2 },
        {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'read',
          content: [{ type: 'text', text: longToolResult }],
          isError: false,
          timestamp: 3
        }
      ],
      turnPrefixMessages: [{ role: 'user', content: [{ type: 'text', text: '重写夜谈场景' }], timestamp: 4 }]
    }
  };
}

function bindHandler(ext: ReturnType<typeof createCompactExt>) {
  let handler: ((event: ReturnType<typeof makeEvent>, ctx: unknown) => Promise<unknown>) | undefined;
  if (typeof ext === 'function') {
    throw new Error('测试要求命名 inline extension');
  }
  ext.factory({
    on: vi.fn((name, value) => {
      if (name === 'session_before_compact') {
        handler = value as typeof handler;
      }
    })
  } as any);

  if (!handler) {
    throw new Error('未注册 session_before_compact handler');
  }

  return handler;
}

describe('createCompactExt', () => {
  it.each(['manual', 'threshold', 'overflow'] as const)('%s 均先走自定义创作检查点并覆盖 native 摘要', async reason => {
    const coord = {
      run: vi.fn(async (_input: any) => ({
        summary: '# 创作会话检查点\n正文',
        summaryRef: '.chaptale/memory/summaries/compactions/checkpoint.md',
        runId: 'run-distill',
        memoryRefs: ['author:preferences']
      }))
    };
    const handler = bindHandler(createCompactExt({ sessionId: 'session-1', cwd: '/session-workspace', coord }));

    const result = await handler(makeEvent(reason), { model: { contextWindow: 32_000 } });

    expect(coord.run).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        cwd: '/session-workspace',
        reason,
        checkpointId: 'entry-kept',
        tokensBefore: 72_000,
        previousSummary: '旧检查点',
        signal: expect.any(AbortSignal),
        maxInputTokens: 9_600
      })
    );
    const input = coord.run.mock.calls[0]![0];
    expect(input.conversation).toContain('继续第三章');
    expect(input.conversation).not.toContain('旧 memory 快照');
    expect(input.conversation).toContain('正文结束');
    expect(input.turnPrefix).toContain('重写夜谈场景');
    expect(result).toEqual({
      compaction: {
        summary: '# 创作会话检查点\n正文',
        firstKeptEntryId: 'entry-kept',
        tokensBefore: 72_000,
        details: {
          kind: 'chaptale-creative-checkpoint',
          schemaVersion: 1,
          checkpointId: 'entry-kept',
          summaryRef: '.chaptale/memory/summaries/compactions/checkpoint.md',
          distillerRunId: 'run-distill',
          memoryRefs: ['author:preferences']
        }
      }
    });
  });

  it('检查点失败时显式取消，禁止 pi 回退到 coding summarizer', async () => {
    const error = new Error('磁盘只读');
    const coord = { run: vi.fn(async (_input: any) => Promise.reject(error)) };
    const onError = vi.fn();
    const handler = bindHandler(
      createCompactExt({ sessionId: 'session-1', cwd: '/session-workspace', coord, onError })
    );

    await expect(handler(makeEvent('threshold'), {})).resolves.toEqual({ cancel: true });
    expect(onError).toHaveBeenCalledWith(error, 'threshold');
  });

  it('错误上报回调自身抛错时仍然 fail-closed', async () => {
    const coord = { run: vi.fn(async (_input: any) => Promise.reject(new Error('蒸馏失败'))) };
    const handler = bindHandler(
      createCompactExt({
        sessionId: 'session-1',
        cwd: '/session-workspace',
        coord,
        onError: () => {
          throw new Error('日志通道失败');
        }
      })
    );

    await expect(handler(makeEvent('overflow'), {})).resolves.toEqual({ cancel: true });
  });
});
