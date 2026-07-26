import { describe, expect, it } from 'vitest';

import { decodeMemoryMessage } from '../message-codec';

describe('decodeMemoryMessage', () => {
  const envelope = '<memory summary="test">\n## 作者偏好要点\n- 喜欢短句\n</memory>\n\n';

  it('strips a leading memory envelope and keeps the rest', () => {
    const decoded = decodeMemoryMessage(`${envelope}帮我审一下这段`);

    expect(decoded.text).toBe('帮我审一下这段');
    expect(decoded.promptPrefix).toBe(envelope);
  });

  it('leaves text without an envelope untouched', () => {
    const decoded = decodeMemoryMessage('普通消息 <memory> 不是行首信封');

    expect(decoded.text).toBe('普通消息 <memory> 不是行首信封');
    expect(decoded.promptPrefix).toBe('');
  });

  it('composes with the context envelope order (memory first)', () => {
    const contextEnvelope = '<attached_context_files>\nfiles\n</attached_context_files>\n\n';
    const decoded = decodeMemoryMessage(`${envelope}${contextEnvelope}正文`);

    expect(decoded.text).toBe(`${contextEnvelope}正文`);
  });
});
