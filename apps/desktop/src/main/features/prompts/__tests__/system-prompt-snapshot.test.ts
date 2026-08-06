import { describe, expect, it } from 'vitest';

import { MEMORY_PROTOCOL } from '../../memory/protocol';
import { builtinCompanionBody } from '../../personas/builtin';
import { TODO_PROTOCOL } from '../../todo/protocol';
import { composeSystemPrompt } from '../compose-system-prompt';
import { PRODUCT_DUTY } from '../product-duty';

describe('内置 systemPrompt 拼装', () => {
  const full = composeSystemPrompt({
    personaBody: builtinCompanionBody,
    productDuty: PRODUCT_DUTY,
    memoryProtocol: MEMORY_PROTOCOL,
    todoProtocol: TODO_PROTOCOL
  });

  it('分层顺序：persona 在最前，todo 协议在 memory 协议之后', () => {
    expect(full.startsWith(builtinCompanionBody)).toBe(true);
    expect(full.indexOf('## 任务清单协议')).toBeGreaterThan(full.indexOf('## 记忆协议'));
  });

  it('关键锚点词存在', () => {
    expect(full).toContain('<memory>');
    expect(full).toContain('memory_save');
    expect(full).toContain('memory_propose');
    expect(full).toContain('todo_write');
  });

  it('产品职责层在 persona 与 memory 协议之间', () => {
    const dutyIndex = full.indexOf('## 工作纪律');
    expect(dutyIndex).toBeGreaterThan(0);
    expect(dutyIndex).toBeLessThan(full.indexOf('## 记忆协议'));
  });

  it('资产红线只在产品职责层，不在 memory 协议', () => {
    expect(PRODUCT_DUTY).toContain('write/edit');
    expect(MEMORY_PROTOCOL).not.toContain('write/edit');
  });
});
