/**
 * models.json 配置类型。
 *
 * 字段语义：
 * - providers：自定义供应商表（key = provider id）；
 * - defaultModel：顶层默认模型（唯一事实源）。
 */

export type ModelsConfig = {
  providers: Record<string, ModelProviderConfig>;
  defaultModel?: ModelRef;
};

export type ModelRef = {
  provider: string;
  modelId: string;
};

export type ModelProviderConfig = {
  name?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models?: ModelDefinition[];
};

export type ModelDefinition = {
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  input?: ('text' | 'image')[];
  contextWindow?: number;
  /** 单次回复最大输出 tokens（0 < n）。 */
  maxTokens?: number;
  /** 采样温度（0–2，越高越发散）；缺省交由服务端默认。 */
  temperature?: number;
  /** 核采样阈值（0–1）；缺省交由服务端默认。 */
  topP?: number;
  headers?: Record<string, string>;
};
