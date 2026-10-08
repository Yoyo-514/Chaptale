import { SessionManager } from '@earendil-works/pi-coding-agent';

import { createHostModelRuntime, createHostSession } from '../../index.ts';

export interface ModelRuntimeProcessInput {
  configDir: string;
  cwd: string;
  agentDir: string;
  model?: { provider: string; id: string };
}

export interface ModelRuntimeProcessResult {
  ok: boolean;
  error?: string;
  models?: { provider: string; id: string }[];
  available?: { provider: string; id: string }[];
  selected?: { provider: string; id: string } | null;
}

const input: ModelRuntimeProcessInput = JSON.parse(process.argv[2]!);

const summarize = (model: { provider: string; id: string }) => ({ provider: model.provider, id: model.id });

// 测试进程只装配和选择模型，不伪造回复、不请求模型，并验证资源释放后的自然退出。
try {
  const modelRuntime = await createHostModelRuntime({ configDir: input.configDir });
  const { session } = await createHostSession({
    cwd: input.cwd,
    agentDir: input.agentDir,
    systemPrompt: '你是创作助手，只讨论作者提供的资料。',
    modelRuntime,
    model: input.model,
    sessionManager: SessionManager.inMemory(input.cwd)
  });
  try {
    const result: ModelRuntimeProcessResult = {
      ok: true,
      models: modelRuntime.getModels().map(summarize),
      available: modelRuntime.getAvailableSnapshot().map(summarize),
      selected: session.model ? summarize(session.model) : null
    };
    console.log(JSON.stringify(result));
  } finally {
    session.dispose();
  }
} catch (error) {
  const result: ModelRuntimeProcessResult = {
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  };
  console.log(JSON.stringify(result));
}
