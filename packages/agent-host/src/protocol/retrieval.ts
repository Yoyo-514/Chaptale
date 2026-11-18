/** 语义检索用的 embedding 服务，按 OpenAI 兼容的 /embeddings 接口调用；密钥不回显。 */
export interface EmbeddingSettingsView {
  baseUrl: string;
  model: string;
  /** 为 null 时请求不带 dimensions，使用模型的默认维度。 */
  dimensions: number | null;
  hasApiKey: boolean;
}

/** 整体替换检索服务设置；apiKey 省略时保留已保存的密钥。 */
export interface EmbeddingSettingsSave {
  baseUrl: string;
  model: string;
  dimensions: number | null;
  apiKey?: string;
}

/** 一部作品的向量索引。段数与字数只算正式内容。 */
export interface VectorIndexStatus {
  workId: string;
  /**
   * unconfigured：还没有设置检索服务；none：作者没有为这部作品建立过索引；
   * stale：索引用的是另一个模型或维度，要重建后才能使用；ready：可以使用，indexed 小于 total 时还有段落没算。
   */
  state: 'unconfigured' | 'none' | 'stale' | 'ready';
  total: number;
  indexed: number;
  /** 全部段落与其中还没算的段落的字数。 */
  characters: number;
  pendingCharacters: number;
  /** 正在建立时本次要算的段数和已经算好的段数。 */
  running: { done: number; total: number } | null;
  /** 上一次建立失败的原因；再次建立时清除。 */
  error?: string;
}
