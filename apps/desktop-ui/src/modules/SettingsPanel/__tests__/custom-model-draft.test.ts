import { describe, expect, it } from 'vitest';

import {
  createCustomModelDraft,
  draftToInput,
  parseContextWindow,
  resetCustomModelDraft
} from '../utils/custom-model-draft';

describe('custom-model-draft', () => {
  it('creates and resets the reusable custom model draft state', () => {
    const draft = createCustomModelDraft();
    draft.modelId = 'model-a';
    draft.modelName = 'Model A';
    draft.contextWindow = 'bad';
    draft.supportsImageInput = true;

    resetCustomModelDraft(draft);

    expect(draft).toEqual({ modelId: '', modelName: '', contextWindow: '128000', supportsImageInput: false });
  });

  it('parses context window only when the user entered a positive finite number', () => {
    expect(parseContextWindow({ ...createCustomModelDraft(), contextWindow: '4096' })).toBe(4096);
    expect(parseContextWindow({ ...createCustomModelDraft(), contextWindow: '0' })).toBeUndefined();
    expect(parseContextWindow({ ...createCustomModelDraft(), contextWindow: 'abc' })).toBeUndefined();
  });

  it('maps image support to the model input capabilities sent to backend', () => {
    expect(draftToInput({ ...createCustomModelDraft(), supportsImageInput: false })).toEqual(['text']);
    expect(draftToInput({ ...createCustomModelDraft(), supportsImageInput: true })).toEqual(['text', 'image']);
  });
});
