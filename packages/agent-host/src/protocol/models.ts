export interface ModelRef {
  provider: string;
  id: string;
}

export interface ModelChoice extends ModelRef {
  name: string;
}

/** models.json 中的模型条目；界面未展示的原生字段原样保留。 */
export interface NativeModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: ('text' | 'image')[];
  contextWindow?: number;
  maxTokens?: number;
  [field: string]: unknown;
}

/** models.json 中的供应商条目，不含密钥。 */
export interface NativeProvider {
  baseUrl?: string;
  api?: string;
  headers?: Record<string, string>;
  models?: NativeModel[];
  [field: string]: unknown;
}

export interface ProviderView {
  id: string;
  config: NativeProvider;
  hasApiKey: boolean;
}

/** 整体替换一个供应商；apiKey 省略时保留已保存的密钥。 */
export interface ProviderSave {
  id: string;
  config: NativeProvider;
  apiKey?: string;
}

/** 按表单中的连接拉取模型列表；apiKey 省略时使用 id 对应供应商已保存的凭据。 */
export interface ModelDiscovery {
  id?: string;
  baseUrl: string;
  api: string;
  headers?: Record<string, string>;
  apiKey?: string;
}

export interface DiscoveredModel {
  id: string;
  name: string;
}
