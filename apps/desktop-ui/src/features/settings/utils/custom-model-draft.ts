/**
 * 自定义模型草稿（“添加供应商”与“已有供应商添加模型”共用）。
 * Context Window、图像输入与采样参数按“每个模型”配置。
 */
export type CustomModelDraft = {
  modelId: string;
  modelName: string;
  contextWindow: string;
  supportsImageInput: boolean;
  /** 单次回复最大输出 tokens（空 = 服务端默认）。 */
  maxTokens: string;
  /** 采样温度 0–2（空 = 服务端默认）。 */
  temperature: string;
  /** 核采样 0–1（空 = 服务端默认）。 */
  topP: string;
};

export function createCustomModelDraft(): CustomModelDraft {
  return {
    modelId: '',
    modelName: '',
    contextWindow: '128000',
    supportsImageInput: false,
    maxTokens: '',
    temperature: '',
    topP: ''
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

/** 解析可选数字字段：空串返回 undefined，非法同样回退 undefined（由后端兜底校验）。 */
export function parseOptionalNumber(text: string): number | undefined {
  if (!text.trim()) {
    return undefined;
  }

  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

export function draftToInput(draft: CustomModelDraft): ('text' | 'image')[] {
  return draft.supportsImageInput ? ['text', 'image'] : ['text'];
}
