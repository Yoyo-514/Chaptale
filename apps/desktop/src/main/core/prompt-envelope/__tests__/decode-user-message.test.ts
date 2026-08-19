import { describe, expect, it } from 'vitest';

import { decodeUserMessage } from '../decode-user-message';

const MEMORY = '<memory>\n林晚左臂为义肢\n</memory>\n\n';
const CONTEXT =
  '<attached_context_files>\n<file path="设定/人物.md" kind="text" size="1 KB" />\n</attached_context_files>\n\n';

describe('decodeUserMessage', () => {
  it('无信封时原样返回', () => {
    expect(decodeUserMessage('继续写第二章')).toEqual({ text: '继续写第二章', contextFiles: [] });
  });

  it('按写入次序剥离记忆与附件信封', () => {
    // 回归：历史读回路径不解码，用户消息带着整块 <memory> 显示在界面与导出 HTML 里。
    const decoded = decodeUserMessage(`${MEMORY}${CONTEXT}看下人物设定`);

    expect(decoded.text).toBe('看下人物设定');
    expect(decoded.contextFiles).toEqual([
      expect.objectContaining({ path: '设定/人物.md', name: '人物.md', kind: 'text' })
    ]);
  });

  it('只有记忆信封时也剥干净', () => {
    expect(decodeUserMessage(`${MEMORY}继续`).text).toBe('继续');
  });

  it('还原 /skill: 紧凑命令，参数里的信封同样剥离', () => {
    const decoded = decodeUserMessage(`/skill:review ${MEMORY}${CONTEXT}检查第一章`);

    expect(decoded.text).toBe('检查第一章');
    expect(decoded.skillInvocation).toEqual({ name: 'review', arguments: '检查第一章' });
    expect(decoded.contextFiles).toHaveLength(1);
  });

  it('还原 <skill> 展开信封', () => {
    const decoded = decodeUserMessage('<skill name="review">\n技能正文\n</skill>\n\n检查第一章');

    expect(decoded.text).toBe('检查第一章');
    expect(decoded.skillInvocation).toEqual({ name: 'review', arguments: '检查第一章' });
  });

  it('不误伤正文里出现的类信封文本（信封必须完整且位于开头）', () => {
    const raw = '帮我看看这段：<memory> 是什么意思';

    expect(decodeUserMessage(raw)).toEqual({ text: raw, contextFiles: [] });
  });

  it('重复解码幂等', () => {
    const once = decodeUserMessage(`${MEMORY}${CONTEXT}看下人物设定`);

    expect(decodeUserMessage(once.text).text).toBe('看下人物设定');
  });
});
