import { describe, expect, it } from 'vitest';

import { MEMORY_PROTOCOL } from '../../memory/protocol';
import { builtinCompanionBody } from '../../personas/builtin';
import { TODO_PROTOCOL } from '../../todo/protocol';
import { composeSystemPrompt } from '../compose-system-prompt';

describe('内置 systemPrompt 拼装', () => {
  const full = composeSystemPrompt({
    personaBody: builtinCompanionBody,
    memoryProtocol: MEMORY_PROTOCOL,
    todoProtocol: TODO_PROTOCOL
  });

  it('完整拼装结果与快照一致', () => {
    expect(full).toMatchSnapshot();
  });

  it('分层顺序：persona 在最前，todo 协议在 memory 协议之后', () => {
    expect(full.startsWith(builtinCompanionBody.slice(0, 20))).toBe(true);
    expect(full.indexOf('## 任务清单协议')).toBeGreaterThan(full.indexOf('## 记忆协议'));
  });

  it('关键锚点词存在', () => {
    expect(full).toContain('<memory>');
    expect(full).toContain('memory_save');
    expect(full).toContain('memory_propose');
    expect(full).toContain('todo_write');
  });
});
