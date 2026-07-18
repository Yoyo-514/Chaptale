export type PiModelsConfig = {
  providers: Record<string, PiProviderConfig>;
};

export type PiProviderConfig = {
  name?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  compat?: unknown;
  modelOverrides?: Record<string, unknown>;
  models?: PiModelDefinition[];
};

export type PiModelDefinition = {
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  input?: ('text' | 'image')[];
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  compat?: unknown;
};
