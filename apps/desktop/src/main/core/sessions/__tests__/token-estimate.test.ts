import { describe, expect, it } from 'vitest';

import type { SessionMessage } from '../entry';
import { estimateMessagesTokens, estimateMessageTokens } from '../token-estimate';

/**
 * 估算口径。
 *
 * 关键性质是**不低估中文**：按 `length / 2` 估算会低估一倍，
 * 而压力阈值是 70%——提示要等真实占用约 140% 时才触发，等于不存在。
 */

const chinese = '这是一段中文正文'.repeat(50); // 400 字

describe('estimateMessageTokens', () => {
  it('中文按一字符一 token，不再低估一半', () => {
    const tokens = estimateMessageTokens({ role: 'user', content: chinese });

    // 旧口径 length/2 = 200；正确口径应当在 400 上下。
    expect(tokens).toBeGreaterThan(390);
  });

  it('ASCII 仍按四字符一 token', () => {
    const tokens = estimateMessageTokens({ role: 'user', content: 'a'.repeat(400) });

    expect(tokens).toBeLessThan(120);
  });

  it('图片按固定块计价，不按 base64 长度', () => {
    const huge = 'A'.repeat(200_000);
    const tokens = estimateMessageTokens({
      role: 'user',
      content: [
        { type: 'text', text: '看这张图' },
        { type: 'image', mimeType: 'image/png', data: huge }
      ]
    });

    // 按 base64 长度算会是五万量级，足以让压缩误判整段历史都得折叠。
    expect(tokens).toBeLessThan(2_000);
  });

  it('assistant 的 toolCalls 计入，reasoning 不计（它不进模型回放）', () => {
    const base: SessionMessage = { role: 'assistant', content: '好的' };
    const withReasoning: SessionMessage = { role: 'assistant', content: '好的', reasoning: chinese };
    const withCalls: SessionMessage = {
      role: 'assistant',
      content: '好的',
      toolCalls: [{ id: 'c1', name: 'write', arguments: { path: '第三章.md', content: chinese } }]
    };

    expect(estimateMessageTokens(withReasoning)).toBe(estimateMessageTokens(base));
    expect(estimateMessageTokens(withCalls)).toBeGreaterThan(estimateMessageTokens(base) + 390);
  });

  it('tool 结果的字符串输出不被 JSON 引号污染', () => {
    const tokens = estimateMessageTokens({ role: 'tool', toolCallId: 'c1', toolName: 'read', output: chinese });

    expect(tokens).toBeGreaterThan(390);
    expect(tokens).toBeLessThan(430);
  });

  it('tool 结果按模型实际收到的预算窗口计，不按落盘原文', () => {
    // 落盘保留完整原文（UI 与导出要读），模型只拿到 8k 预算窗口且不含 details。
    // 按原文量会把一次大 read 记成几倍真实占用：压力提示提前报警，
    // 压缩保留区间被无谓压缩——与"低估中文"同型的口径分叉，方向相反。
    const huge = '中'.repeat(60_000);
    const tokens = estimateMessageTokens({
      role: 'tool',
      toolCallId: 'c1',
      toolName: 'fetch_content',
      output: { text: huge, details: { markdown: huge } }
    });

    expect(tokens).toBeLessThan(8_100);
  });
});

describe('estimateMessagesTokens', () => {
  it('逐条累加，且每条计入协议开销', () => {
    const messages: SessionMessage[] = [
      { role: 'user', content: '甲' },
      { role: 'assistant', content: '乙' }
    ];

    // 两条各 1 token 正文 + 各 4 token 开销。
    expect(estimateMessagesTokens(messages)).toBe(10);
  });

  it('空会话为 0', () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });
});
