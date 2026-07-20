import { describe, expect, it } from 'vitest';

import {
  AddCustomModelArgsValidator,
  AddCustomProviderArgsValidator,
  AgentCancelArgsValidator,
  AgentClearPendingMessagesArgsValidator,
  AgentInspectContextFilesArgsValidator,
  AgentStartArgsValidator,
  AgentSteerArgsValidator,
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
  TaskCancelArgsValidator,
  TaskListRunsArgsValidator,
  TaskRunArgsValidator,
  TodosGetArgsValidator,
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

  it('校验 Agent steer 与清空待处理消息参数', () => {
    expect(
      AgentSteerArgsValidator.Check([{ runId: 'run-1', query: '调整方向', contextFilePaths: ['C:/novel/outline.md'] }])
    ).toBe(true);
    expect(AgentSteerArgsValidator.Check([{ runId: 'run-1', query: '' }])).toBe(false);
    expect(AgentSteerArgsValidator.Check([{ runId: 'run-1', query: '调整', extra: true }])).toBe(false);
    expect(AgentClearPendingMessagesArgsValidator.Check([{ runId: 'run-1' }])).toBe(true);
    expect(AgentClearPendingMessagesArgsValidator.Check([{ runId: 'run-1', extra: true }])).toBe(false);
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

  it('校验任务运行参数：拒绝空 personaId 与额外字段，允许空 text（由附件兜底）', () => {
    expect(TaskRunArgsValidator.Check([{ personaId: 'continuity-reviewer', brief: '审查', text: '正文' }])).toBe(true);
    expect(
      TaskRunArgsValidator.Check([
        { personaId: 'continuity-reviewer', brief: '审查', text: '', contextFilePaths: ['/a.md'] }
      ])
    ).toBe(true);
    expect(TaskRunArgsValidator.Check([{ personaId: '', brief: '审查', text: '正文' }])).toBe(false);
    expect(
      TaskRunArgsValidator.Check([{ personaId: 'continuity-reviewer', brief: '审查', text: '正文', extra: 1 }])
    ).toBe(false);
    expect(
      TaskRunArgsValidator.Check([
        { personaId: 'continuity-reviewer', brief: '审查', text: 'x', contextFilePaths: 'no' }
      ])
    ).toBe(false);
  });

  it('校验任务取消与运行列表参数', () => {
    expect(TaskCancelArgsValidator.Check([{ runId: 'r1' }])).toBe(true);
    expect(TaskCancelArgsValidator.Check([{ runId: '' }])).toBe(false);

    expect(TaskListRunsArgsValidator.Check([{}])).toBe(true);
    expect(TaskListRunsArgsValidator.Check([{ limit: 10, personaId: 'p' }])).toBe(true);
    expect(TaskListRunsArgsValidator.Check([{ limit: 0 }])).toBe(false);
    expect(TaskListRunsArgsValidator.Check([{ limit: 1.5 }])).toBe(false);
  });

  it('校验 todo 清单查询参数：仅接受非空 sessionId', () => {
    expect(TodosGetArgsValidator.Check(['session-1'])).toBe(true);
    expect(TodosGetArgsValidator.Check([''])).toBe(false);
    expect(TodosGetArgsValidator.Check([])).toBe(false);
    expect(TodosGetArgsValidator.Check([1])).toBe(false);
  });
});
