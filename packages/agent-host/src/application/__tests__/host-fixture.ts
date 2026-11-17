import { createAssistantMessageEventStream, InMemoryCredentialStore, type Message } from '@earendil-works/pi-ai';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';

import {
  type EditMode,
  type EditorContext,
  type InstructionEntry,
  instructionsEntryType,
  modeEntryType
} from '../../protocol/index.ts';
import { HostModelConfiguration } from '../../runtime/model-configuration.ts';
import { HostApplication, type HostApplicationOptions } from '../index.ts';

export let root: string;
export let app: HostApplication;
export let options: HostApplicationOptions;
export let captured: Message[][];
export const model = { provider: 'application-test', id: 'offline-model' };
export const capture = { provider: 'application-capture', id: 'capture-model' };
export function entry(name: string, role: InstructionEntry['role'], text: string, enabled = true): InstructionEntry {
  return { name, role, text, enabled };
}
export const builtin = [entry('主创', 'system', '应用内置指令')];
export const zeroUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};
export const offlineModel = {
  name: '离线模型',
  reasoning: false,
  input: ['text' as const],
  contextWindow: 8192,
  maxTokens: 512,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
};
export function makeEditorContext(title: string): EditorContext {
  return {
    workId: 'work',
    entryId: title,
    title,
    section: 'manuscript',
    selection: `选中${title}`
  };
}
export async function create(instructions?: string, target = model) {
  return (await app.execute({ method: 'create', input: { model: target, instructions, workId: null } })) as string;
}
export async function open(input: { file: string }) {
  return (await app.execute({ method: 'open', input })) as string;
}
export function view(id: string) {
  return app.snapshot().sessions.find(session => session.id === id)!;
}
export function settled() {
  return new Promise<void>(resolve => {
    const off = app.subscribe(event => {
      if (event.kind === 'running' && !event.running) {
        off();
        resolve();
      }
    });
  });
}
export function history(
  texts = ['历史输入'],
  records: { entries?: unknown; mode?: EditMode } = {
    entries: [entry('会话', 'system', '会话自己的指令')],
    mode: 'review'
  }
) {
  const manager = SessionManager.create(options.cwd, join(options.sessionDir, 'unassigned'));
  if (records.entries) manager.appendCustomEntry(instructionsEntryType, { entries: records.entries });
  if (records.mode) manager.appendCustomEntry(modeEntryType, { mode: records.mode });
  for (const text of texts) manager.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
  return { file: manager.getSessionFile()! };
}
export async function restart(overrides: Partial<HostApplicationOptions> = {}) {
  await app.dispose();
  app = await HostApplication.create({ ...options, ...overrides });
}

/** 每个用例使用独立的临时目录与宿主；在测试文件顶层调用一次。 */
export function setupHost() {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'chaptale-application-'));
    for (const part of ['agent', 'sessions', 'work', 'data']) await mkdir(join(root, part));
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false
    });
    runtime.registerProvider(model.provider, {
      baseUrl: 'http://127.0.0.1:9',
      api: 'openai-completions',
      models: [{ id: model.id, ...offlineModel }]
    });
    // 只记录 SDK 实际发出的请求并返回错误，不生成模型回复。
    captured = [];
    runtime.registerProvider(capture.provider, {
      baseUrl: 'http://127.0.0.1:9',
      apiKey: 'offline-capture',
      api: 'application-capture',
      models: [{ id: capture.id, ...offlineModel }],
      streamSimple: (target, context) => {
        captured.push(structuredClone(context.messages));
        const stream = createAssistantMessageEventStream();
        const error = {
          role: 'assistant' as const,
          content: [],
          api: target.api,
          provider: target.provider,
          model: target.id,
          usage: zeroUsage,
          stopReason: 'error' as const,
          errorMessage: '离线测试不请求模型',
          timestamp: Date.now()
        };
        queueMicrotask(() => stream.push({ type: 'error', reason: 'error', error }));
        return stream;
      }
    });
    options = {
      cwd: join(root, 'work'),
      agentDir: join(root, 'agent'),
      sessionDir: join(root, 'sessions'),
      settingsFile: join(root, 'data', 'settings.json'),
      builtinInstructions: builtin,
      modelRuntime: runtime,
      modelConfiguration: new HostModelConfiguration(join(root, 'config'), runtime),
      tools: () => []
    };
    app = await HostApplication.create(options);
  });
  afterEach(async () => {
    await app.dispose();
    await rm(root, { recursive: true, force: true });
  });
}
