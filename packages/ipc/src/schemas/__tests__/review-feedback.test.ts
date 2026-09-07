import { describe, expect, it } from 'vitest';

import { ResolveReviewFeedbackValidator } from '../../reviews';

const request = {
  rootPath: 'E:/books/story',
  suggestionId: 'a'.repeat(64),
  action: 'accept',
  text: '降低节奏检查频率'
};
describe('审查偏好 IPC', () => {
  it('只接受绑定具体建议的确认或不再提示请求', () => {
    expect(ResolveReviewFeedbackValidator.Check([request])).toBe(true);
    expect(ResolveReviewFeedbackValidator.Check([{ ...request, action: 'dismiss' }])).toBe(true);
    for (const patch of [
      { suggestionId: '../outside' },
      { action: 'auto' },
      { text: '' },
      { text: 'x'.repeat(4001) },
      { outputRef: 'author/preferences.md' },
      { personaId: 'draft' }
    ])
      expect(ResolveReviewFeedbackValidator.Check([{ ...request, ...patch }])).toBe(false);
  });
});
