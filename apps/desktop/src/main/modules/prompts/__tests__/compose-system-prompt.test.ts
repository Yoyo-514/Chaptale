import { describe, expect, it } from 'vitest';

import { composeSystemPrompt } from '../compose-system-prompt';

describe('composeSystemPrompt', () => {
  it('uses the persona body as the base layer', () => {
    expect(composeSystemPrompt({ personaBody: 'persona 正文' })).toBe('persona 正文');
  });

  it('replaces only the persona layer when SYSTEM.md is discovered', () => {
    const result = composeSystemPrompt({
      personaBody: 'persona 正文',
      discoveredSystemMd: '用户自定义',
      productDuty: '职责层'
    });

    expect(result).toBe('用户自定义\n\n职责层');
  });

  it('keeps the persona layer when SYSTEM.md is blank', () => {
    expect(composeSystemPrompt({ personaBody: 'persona 正文', discoveredSystemMd: '  \n' })).toBe('persona 正文');
  });

  it('joins layers in persona → duty → memory order and skips empty layers', () => {
    const result = composeSystemPrompt({
      personaBody: 'persona',
      productDuty: '',
      memoryProtocol: '记忆协议'
    });

    expect(result).toBe('persona\n\n记忆协议');
  });

  it('is deterministic for identical inputs (prompt cache safety)', () => {
    const options = { personaBody: 'a', productDuty: 'b', memoryProtocol: 'c' };

    expect(composeSystemPrompt(options)).toBe(composeSystemPrompt(options));
  });
});
