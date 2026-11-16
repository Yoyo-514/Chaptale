import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@chaptale/agent-host/protocol';

import { buildTranscript, summarizeTools, toolRows } from '../transcript';

const message = (fields: Partial<ChatMessage> & Pick<ChatMessage, 'role'>): ChatMessage => ({
  text: '',
  thinking: '',
  tools: [],
  ...fields
});

describe('buildTranscript', () => {
  it('压缩总结单独成条，压缩前的消息保留并带标记', () => {
    const items = buildTranscript([
      message({ role: 'user', text: '早先的讨论', compacted: true }),
      message({ role: 'assistant', text: '早先的回复', compacted: true }),
      message({ role: 'compactionSummary', text: '## 进度：写完第三章' }),
      message({ role: 'user', text: '继续' })
    ]);
    expect(items).toMatchObject([
      { kind: 'user', text: '早先的讨论', compacted: true },
      { kind: 'assistant', text: '早先的回复', compacted: true },
      { kind: 'summary', key: '2', text: '## 进度：写完第三章' },
      { kind: 'user', text: '继续', compacted: undefined }
    ]);
  });

  it('作者处理结果单独成条，不并入助手回复', () => {
    const items = buildTranscript([
      message({ role: 'assistant', text: '已改好第一章' }),
      message({
        role: 'reviewResults',
        text: '作者已处理 2 处修改',
        outcomes: [
          { id: 'r1', text: '《第一章》已接受' },
          { id: 'r2', text: '《第二章》已拒绝' }
        ]
      }),
      message({ role: 'assistant', text: '继续第二章' })
    ]);
    expect(items).toMatchObject([
      { kind: 'assistant', text: '已改好第一章' },
      {
        kind: 'notice',
        key: '1',
        text: '作者已处理 2 处修改',
        outcomes: [
          { id: 'r1', text: '《第一章》已接受' },
          { id: 'r2', text: '《第二章》已拒绝' }
        ]
      },
      { kind: 'assistant', text: '继续第二章' }
    ]);
  });

  it('工具结果并回发起它的工具行，不单独成条', () => {
    const items = buildTranscript([
      message({ role: 'user', text: '看看第一章' }),
      message({
        role: 'assistant',
        text: '我先读一下。',
        thinking: '需要读取正文',
        tools: [{ id: 'a', name: 'read', input: { path: '正文/第一章.md' } }]
      }),
      message({ role: 'toolResult', toolCallId: 'a', toolName: 'read', text: '雪落在窗沿' }),
      message({ role: 'assistant', text: '读完了。' })
    ]);
    expect(items.map(item => item.kind)).toEqual(['user', 'assistant', 'assistant']);
    const first = items[1]!;
    expect(first.kind === 'assistant' && first.thinking?.text).toBe('需要读取正文');
    expect(first.kind === 'assistant' && first.tools[0]).toMatchObject({
      summary: '读取了 正文/第一章.md',
      result: { text: '雪落在窗沿', error: false }
    });
  });

  it('同名工具按原生调用身份匹配结果，失败结果保留错误标记', () => {
    const [, assistant] = buildTranscript([
      message({ role: 'user', text: '找人物' }),
      message({
        role: 'assistant',
        tools: [
          { id: 'a', name: 'grep', input: { pattern: '林晚', path: '正文' } },
          { id: 'b', name: 'grep', input: { pattern: '沈舟' } }
        ]
      }),
      message({ role: 'toolResult', toolCallId: 'a', toolName: 'grep', text: '第一处' }),
      message({ role: 'toolResult', toolCallId: 'b', toolName: 'grep', text: '没有权限', error: true })
    ]);
    expect(assistant!.kind === 'assistant' && assistant!.tools.map(tool => [tool.summary, tool.result])).toEqual([
      ['搜索了 林晚 · 正文', { text: '第一处', error: false }],
      ['未能搜索 沈舟', { text: '没有权限', error: true }]
    ]);
  });

  it('尚未返回的工具显示进行中的说法', () => {
    const [assistant] = buildTranscript([
      message({ role: 'assistant', tools: [{ id: 'a', name: 'ls', input: { path: '资料' } }] })
    ]);
    expect(assistant!.kind === 'assistant' && assistant!.tools[0]).toMatchObject({ summary: '查看目录 资料' });
    expect(assistant!.kind === 'assistant' && assistant!.tools[0]!.result).toBeUndefined();
  });

  it('codemode 按子调用汇总动作计数，展开时保留脚本入口、作品条目跳转与失败摘要', () => {
    const [assistant] = buildTranscript([
      message({
        role: 'assistant',
        tools: [{ id: 'cm-1', name: 'codemode', input: { code: 'return 1;' } }]
      }),
      message({
        role: 'toolResult',
        toolCallId: 'cm-1',
        toolName: 'codemode',
        text: 'Script completed',
        nestedToolsComplete: true,
        nestedTools: [
          {
            id: 'cm-1/1',
            name: 'work_read',
            input: { workId: 'w1', entryId: 'c1' },
            status: 'ok',
            info: { workId: 'w1', entryId: 'c1', title: '第一章', section: 'manuscript' }
          },
          {
            id: 'cm-1/2',
            name: 'work_record_write',
            input: { workId: 'w1', text: '沈临巡城' },
            status: 'ok'
          },
          {
            id: 'cm-1/3',
            name: 'work_edit',
            input: { workId: 'w1', entryId: 'c1' },
            status: 'error',
            error: '文稿修订已变化',
            info: { workId: 'w1', entryId: 'c1', title: '第一章', section: 'manuscript' }
          }
        ]
      })
    ]);
    expect(assistant?.kind).toBe('assistant');
    if (!assistant || assistant.kind !== 'assistant') return;
    expect(summarizeTools(assistant.tools)).toBe('读取 1 份 · 记录事件 1 条 · 修改文稿 1 份');
    const rows = toolRows(assistant.tools);
    expect(rows.map(row => row.summary)).toEqual([
      '执行脚本',
      '读取《第一章》',
      '记录事件：沈临巡城',
      '未能修改文稿《第一章》：文稿修订已变化'
    ]);
    expect(rows[1]!.entryTarget).toEqual({ workId: 'w1', entryId: 'c1', title: '第一章' });
    expect(rows[3]!.result).toEqual({ text: '文稿修订已变化', error: true });
  });

  it('连续工具调用后的空正文报错或主动停止合并入同一助手块并保留最新下标', () => {
    const items = buildTranscript([
      message({ role: 'user', entryId: 'u-1', text: '分析第一章' }),
      message({
        role: 'assistant',
        tools: [{ id: 't-1', name: 'work_read', input: { workId: 'w1', entryId: 'c1' } }]
      }),
      message({ role: 'toolResult', toolCallId: 't-1', toolName: 'work_read', text: '正文' }),
      message({
        role: 'assistant',
        error: true,
        errorMessage: '429 {"error":{"message":"Rate limit"}}'
      })
    ]);
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      kind: 'assistant',
      index: 3,
      error: true,
      errorMessage: '429 {"error":{"message":"Rate limit"}}',
      retryTarget: { entryId: 'u-1', text: '分析第一章' }
    });
  });
});
