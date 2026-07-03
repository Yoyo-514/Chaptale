/**
 * 自定义模型草稿（“添加供应商”与“已有供应商添加模型”共用）。
 * Context Window 与图像输入按“每个模型”配置。
 */
export type CustomModelDraft = {
  modelId: string;
  modelName: string;
  contextWindow: string;
  supportsImageInput: boolean;
};

export function createCustomModelDraft(): CustomModelDraft {
  return {
    modelId: '',
    modelName: '',
    contextWindow: '128000',
    supportsImageInput: false
  };
}

export function resetCustomModelDraft(draft: CustomModelDraft) {
  Object.assign(draft, createCustomModelDraft());
}

/** 解析草稿中的 Context Window；空/非法返回 undefined，由后端使用默认值。 */
export function parseContextWindow(draft: CustomModelDraft) {
  const value = Number(draft.contextWindow);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function draftToInput(draft: CustomModelDraft): ('text' | 'image')[] {
  return draft.supportsImageInput ? ['text', 'image'] : ['text'];
}
