import { describe, expect, it } from 'vitest';

import {
  AddCustomModelArgsValidator,
  AddCustomProviderArgsValidator,
  AgentCancelArgsValidator,
  AgentInspectContextFilesArgsValidator,
  AgentStartArgsValidator,
  CreateSessionArgsValidator,
  DeleteSessionArgsValidator,
  DeleteSessionsArgsValidator,
  ExportSessionArgsValidator,
  FetchCustomProviderModelsArgsValidator,
  ReadSessionImageArgsValidator,
  RemoveCustomModelArgsValidator,
  RemoveCustomProviderApiKeyArgsValidator,
  RemoveProviderAuthArgsValidator,
  RenameSessionArgsValidator,
  SessionIdArgsValidator,
  SetCustomProviderApiKeyArgsValidator,
  SetDefaultModelArgsValidator,
  SetProviderApiKeyArgsValidator,
  SetSessionLeafArgsValidator,
  UpdateChaptaleSettingsArgsValidator,
  UpdateCustomModelInputArgsValidator,
  UpdatePiWebAccessSettingsArgsValidator,
  UpdatePromptSettingsArgsValidator
} from '../../index';

function expectStrictObject(
  validator: { Check(value: unknown): boolean },
  validPayload: Record<string, unknown>
): void {
  expect(validator.Check([validPayload])).toBe(true);
  expect(validator.Check([{ ...validPayload, extra: true }])).toBe(false);
}

describe('IPC 参数 Schema', () => {
  it('校验会话重命名参数并拒绝缺失或额外字段', () => {
    expect(RenameSessionArgsValidator.Check([{ sessionId: 's1', name: '新名称' }])).toBe(true);
    expect(RenameSessionArgsValidator.Check([{ sessionId: 's1' }])).toBe(false);
    expect(RenameSessionArgsValidator.Check([{ sessionId: 's1', name: 'x', extra: true }])).toBe(false);
  });

  it('校验 Agent 启动参数', () => {
    expect(AgentStartArgsValidator.Check([{ runId: 'r1', query: 'hello' }])).toBe(true);
    expect(
      AgentStartArgsValidator.Check([
        {
          runId: 'r1',
          query: '',
          sessionId: '',
          branchFromEntryId: null,
          contextFilePaths: [],
          reuseUserEntryId: ''
        }
      ])
    ).toBe(true);
    expect(AgentStartArgsValidator.Check([{ runId: '', query: 1 }])).toBe(false);
    expect(AgentStartArgsValidator.Check([{ runId: 'r1', query: 'hello', extra: true }])).toBe(false);
  });

  it('校验 Agent 取消与文件检查参数', () => {
    expect(AgentCancelArgsValidator.Check(['r1'])).toBe(true);
    expect(AgentCancelArgsValidator.Check([1])).toBe(false);
    expect(AgentInspectContextFilesArgsValidator.Check([['C:/a.txt']])).toBe(true);
    expect(AgentInspectContextFilesArgsValidator.Check([['C:/a.txt', 1]])).toBe(false);
  });

  it('校验会话创建、ID 和图片读取参数', () => {
    expect(CreateSessionArgsValidator.Check([])).toBe(true);
    expect(CreateSessionArgsValidator.Check([undefined])).toBe(true);
    expect(CreateSessionArgsValidator.Check([{ id: '', name: '', cwd: '', parentSessionPath: '' }])).toBe(true);
    expect(CreateSessionArgsValidator.Check([{ id: 's1', extra: true }])).toBe(false);

    expect(SessionIdArgsValidator.Check(['s1'])).toBe(true);
    expect(SessionIdArgsValidator.Check([1])).toBe(false);

    expectStrictObject(ReadSessionImageArgsValidator, {
      type: 'session-entry',
      sessionId: 's1',
      entryId: 'e1',
      blockIndex: 0
    });
    expectStrictObject(ReadSessionImageArgsValidator, { type: 'context-file', path: 'C:/image.png' });
  });

  it('校验其余会话修改参数', () => {
    expectStrictObject(ExportSessionArgsValidator, { sessionId: 's1' });
    expectStrictObject(DeleteSessionArgsValidator, { sessionId: 's1' });
    expectStrictObject(DeleteSessionsArgsValidator, { sessionIds: [] });
    expectStrictObject(SetSessionLeafArgsValidator, { sessionId: 's1', leafId: null });
    expect(SetSessionLeafArgsValidator.Check([{ sessionId: 's1', leafId: 'e1' }])).toBe(true);
  });

  it('校验应用和 Web Access 设置更新参数', () => {
    expectStrictObject(UpdateChaptaleSettingsArgsValidator, {});
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ storage: { mode: 'workspace', workspacePath: '' } }])).toBe(
      true
    );
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ storage: { mode: 'global', extra: true } }])).toBe(false);
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ lastSessionId: null }])).toBe(true);

    expectStrictObject(UpdatePiWebAccessSettingsArgsValidator, {});
    expect(
      UpdatePiWebAccessSettingsArgsValidator.Check([
        {
          provider: 'auto',
          workflow: 'none',
          openaiApiKey: '',
          curatorTimeoutSeconds: 0,
          githubClone: { enabled: false, maxRepoSizeMB: 0, cloneTimeoutSeconds: 0, clonePath: '' },
          youtube: { enabled: true, preferredModel: '' },
          video: { enabled: true, preferredModel: '', maxSizeMB: 0 },
          ssrf: { allowRanges: [] }
        }
      ])
    ).toBe(true);
    expect(UpdatePiWebAccessSettingsArgsValidator.Check([{ githubClone: { extra: true } }])).toBe(false);
  });

  it('校验提示词更新参数', () => {
    expectStrictObject(UpdatePromptSettingsArgsValidator, { systemPrompt: '', appendSystemPrompt: '' });
    expect(UpdatePromptSettingsArgsValidator.Check([{ systemPrompt: '' }])).toBe(false);
  });

  it('校验模型供应商和模型修改参数', () => {
    expectStrictObject(SetDefaultModelArgsValidator, { provider: '', modelId: '' });
    expectStrictObject(SetProviderApiKeyArgsValidator, { provider: '', apiKey: '' });
    expectStrictObject(FetchCustomProviderModelsArgsValidator, {});
    expect(
      FetchCustomProviderModelsArgsValidator.Check([
        { provider: '', baseUrl: '', api: 'openai-completions', apiKey: '' }
      ])
    ).toBe(true);
    expectStrictObject(AddCustomProviderArgsValidator, {
      provider: '',
      providerName: '',
      baseUrl: '',
      api: 'anthropic-messages',
      apiKey: '',
      models: [{ modelId: '', modelName: '', input: [], contextWindow: 0 }]
    });
    expect(
      AddCustomProviderArgsValidator.Check([
        {
          provider: '',
          providerName: '',
          baseUrl: '',
          api: 'anthropic-messages',
          models: [{ modelId: '', input: [], extra: true }]
        }
      ])
    ).toBe(false);
    expectStrictObject(AddCustomModelArgsValidator, {
      provider: '',
      modelId: '',
      modelName: '',
      input: ['text', 'image'],
      contextWindow: 0
    });
    expectStrictObject(SetCustomProviderApiKeyArgsValidator, { provider: '', apiKey: '' });
    expectStrictObject(RemoveCustomProviderApiKeyArgsValidator, { provider: '' });
    expectStrictObject(UpdateCustomModelInputArgsValidator, { provider: '', modelId: '', input: [] });
    expectStrictObject(RemoveCustomModelArgsValidator, { provider: '', modelId: '' });
    expectStrictObject(RemoveProviderAuthArgsValidator, { provider: '' });

    expect(UpdateCustomModelInputArgsValidator.Check([{ provider: '', modelId: '', input: ['audio'] }])).toBe(false);
  });
});
