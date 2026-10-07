import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';

import { createHostSession } from '../../index.ts';

export interface SessionProcessInput {
  cwd: string;
  agentDir: string;
  sessionDir: string;
  file?: string;
  messages?: string[];
}

// 使用真实 SDK 的独立进程；不请求模型，也不调用 process.exit() 掩盖未释放资源。
const input: SessionProcessInput = JSON.parse(process.argv[2]!);
const manager = input.file ? SessionManager.open(input.file) : SessionManager.create(input.cwd, input.sessionDir);
const modelRuntime = await ModelRuntime.create({
  credentials: new InMemoryCredentialStore(),
  modelsPath: null,
  allowModelNetwork: false,
  refreshOnCreate: false
});
const { session } = await createHostSession({
  cwd: input.cwd,
  agentDir: input.agentDir,
  systemPrompt: '你是创作助手，只讨论作者提供的资料。',
  modelRuntime,
  sessionManager: manager
});
try {
  const restoredMessages = session.state.messages;
  for (const content of input.messages ?? []) {
    // 固定用户消息是存储测试输入，不伪造模型回复；写入后不继续运行当前 Agent。
    manager.appendMessage({ role: 'user', content, timestamp: Date.now() });
  }
  console.log(
    JSON.stringify({
      id: manager.getSessionId(),
      file: manager.getSessionFile(),
      cwd: manager.getCwd(),
      restoredMessages,
      messages: manager.buildSessionContext().messages,
      entries: manager.getEntries().filter(entry => entry.type === 'message')
    })
  );
} finally {
  session.dispose();
}
