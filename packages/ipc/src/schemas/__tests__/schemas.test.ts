import { describe, expect, it } from 'vitest';

import {
  AddCustomModelArgsValidator,
  AddCustomProviderArgsValidator,
  AgentCancelArgsValidator,
  AgentClearPendingMessagesArgsValidator,
  AgentCompactSessionArgsValidator,
  AgentEndEventValidator,
  AgentGetContextPressureArgsValidator,
  AgentInspectContextFilesArgsValidator,
  MemoryListPendingArgsValidator,
  MemoryResolvePendingArgsValidator,
  AgentStartArgsValidator,
  AgentSteerArgsValidator,
  CreateSessionArgsValidator,
  DeleteSessionArgsValidator,
  DeleteSessionsArgsValidator,
  ExportSessionArgsValidator,
  FetchCustomProviderModelsArgsValidator,
  PermissionsDecideArgsValidator,
  PermissionsListRulesArgsValidator,
  PermissionsPendingArgsValidator,
  PermissionsRemoveRuleArgsValidator,
  ReadSessionImageArgsValidator,
  RemoveCustomModelArgsValidator,
  RemoveCustomProviderApiKeyArgsValidator,
  RenameSessionArgsValidator,
  SessionIdArgsValidator,
  SetCustomProviderApiKeyArgsValidator,
  SetDefaultModelArgsValidator,
  SetSessionLeafArgsValidator,
  AgentRunsListResultValidator,
  TaskCancelArgsValidator,
  TaskListRunsArgsValidator,
  TaskReadRunOutputResponseValidator,
  TaskReadRunOutputResultValidator,
  TaskRunArgsValidator,
  TodosGetArgsValidator,
  UpdateChaptaleSettingsArgsValidator,
  UpdateCustomModelInputArgsValidator,
  UpdateWebToolsSettingsArgsValidator,
  UpdatePromptSettingsArgsValidator
} from '../../index';

function expectStrictObject(
  validator: { Check(value: unknown): boolean },
  validPayload: Record<string, unknown>
): void {
  expect(validator.Check([validPayload])).toBe(true);
  expect(validator.Check([{ ...validPayload, extra: true }])).toBe(false);
}

const decideArgs = (decision: unknown) => [{ requestId: 'r1', decision }];

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
          sessionId: 's1',
          branchFromEntryId: null,
          contextFilePaths: [],
          reuseUserEntryId: ''
        }
      ])
    ).toBe(true);
    expect(AgentStartArgsValidator.Check([{ runId: '', query: 1 }])).toBe(false);
    expect(AgentStartArgsValidator.Check([{ runId: 'r1', query: 'hello', extra: true }])).toBe(false);
    // 空或含路径分隔符的 sessionId 必须被拒绝（拼接会话文件路径的入口）。
    expect(AgentStartArgsValidator.Check([{ runId: 'r1', query: 'hello', sessionId: '' }])).toBe(false);
    expect(AgentStartArgsValidator.Check([{ runId: 'r1', query: 'hello', sessionId: '../escape' }])).toBe(false);
  });

  it('校验 Agent 取消与文件检查参数', () => {
    expect(AgentCancelArgsValidator.Check(['r1'])).toBe(true);
    expect(AgentCancelArgsValidator.Check([1])).toBe(false);
    expect(AgentInspectContextFilesArgsValidator.Check([['C:/a.txt']])).toBe(true);
    expect(AgentInspectContextFilesArgsValidator.Check([['C:/a.txt', 1]])).toBe(false);
  });

  it('校验 Agent 三种显式终态并拒绝不完整失败信息', () => {
    expect(AgentEndEventValidator.Check({ runId: 'r1', end: { status: 'completed' } })).toBe(true);
    expect(AgentEndEventValidator.Check({ runId: 'r1', end: { status: 'cancelled' } })).toBe(true);
    expect(
      AgentEndEventValidator.Check({
        runId: 'r1',
        end: { status: 'failed', code: 'AGENT_RUN_FAILED', message: 'x', retryable: false }
      })
    ).toBe(true);
    expect(AgentEndEventValidator.Check({ runId: 'r1', end: { status: 'failed', message: 'x' } })).toBe(false);
    expect(AgentEndEventValidator.Check({ runId: 'r1', end: { status: 'cancelled', message: 'x' } })).toBe(false);
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
    expect(CreateSessionArgsValidator.Check([{ name: '', cwd: '', parentSessionPath: '' }])).toBe(true);
    expect(CreateSessionArgsValidator.Check([{ id: 's1', extra: true }])).toBe(false);
    // 空 id / 含路径分隔符的 id 必须拒绝（id 直接拼进会话文件名）。
    expect(CreateSessionArgsValidator.Check([{ id: '', name: '' }])).toBe(false);
    expect(CreateSessionArgsValidator.Check([{ id: '../escape', name: '' }])).toBe(false);

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

  it('校验应用和联网能力设置更新参数', () => {
    expectStrictObject(UpdateChaptaleSettingsArgsValidator, {});
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ storage: { mode: 'workspace', workspacePath: '' } }])).toBe(
      true
    );
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ storage: { mode: 'global', extra: true } }])).toBe(false);
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ lastSessionId: null }])).toBe(true);

    expectStrictObject(UpdateWebToolsSettingsArgsValidator, {});
    expect(
      UpdateWebToolsSettingsArgsValidator.Check([
        {
          search: { enabled: true, provider: 'duckduckgo' },
          keys: { braveApiKey: '', tavilyApiKey: '', exaApiKey: '' },
          fetch: { timeoutSeconds: 0, maxBytes: 0 },
          ssrf: { allowRanges: [] }
        }
      ])
    ).toBe(true);
    expect(UpdateWebToolsSettingsArgsValidator.Check([{ search: { provider: 'google' } }])).toBe(false);
    expect(UpdateWebToolsSettingsArgsValidator.Check([{ keys: { openaiApiKey: 'x' } }])).toBe(false);
  });

  it('校验提示词更新参数', () => {
    expectStrictObject(UpdatePromptSettingsArgsValidator, { systemPrompt: '', appendSystemPrompt: '' });
    expect(UpdatePromptSettingsArgsValidator.Check([{ systemPrompt: '' }])).toBe(false);
  });

  it('校验模型供应商和模型修改参数', () => {
    expectStrictObject(SetDefaultModelArgsValidator, { provider: '', modelId: '' });
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

    expect(UpdateCustomModelInputArgsValidator.Check([{ provider: '', modelId: '', input: ['audio'] }])).toBe(false);
  });

  it('校验任务运行参数：要求 requestId，拒绝空 personaId 与额外字段，允许空 text（由附件兜底）', () => {
    expect(
      TaskRunArgsValidator.Check([
        { requestId: 'req-1', personaId: 'continuity-reviewer', brief: '审查', text: '正文' }
      ])
    ).toBe(true);
    expect(
      TaskRunArgsValidator.Check([
        { requestId: 'req-1', personaId: 'continuity-reviewer', brief: '审查', text: '', contextFilePaths: ['/a.md'] }
      ])
    ).toBe(true);
    expect(TaskRunArgsValidator.Check([{ personaId: 'continuity-reviewer', brief: '审查', text: '正文' }])).toBe(false);
    expect(TaskRunArgsValidator.Check([{ requestId: 'req-1', personaId: '', brief: '审查', text: '正文' }])).toBe(
      false
    );
    expect(
      TaskRunArgsValidator.Check([
        { requestId: 'req-1', personaId: 'continuity-reviewer', brief: '审查', text: '正文', extra: 1 }
      ])
    ).toBe(false);
    expect(
      TaskRunArgsValidator.Check([
        { requestId: 'req-1', personaId: 'continuity-reviewer', brief: '审查', text: 'x', contextFilePaths: 'no' }
      ])
    ).toBe(false);
  });

  it('校验任务取消与运行列表参数', () => {
    expect(TaskCancelArgsValidator.Check([{ requestId: 'req-1' }])).toBe(true);
    expect(TaskCancelArgsValidator.Check([{ requestId: '' }])).toBe(false);
    expect(TaskCancelArgsValidator.Check([{ runId: 'r1' }])).toBe(false);

    expect(TaskListRunsArgsValidator.Check([{}])).toBe(true);
    expect(TaskListRunsArgsValidator.Check([{ limit: 10, personaId: 'p' }])).toBe(true);
    expect(TaskListRunsArgsValidator.Check([{ limit: 0 }])).toBe(false);
    expect(TaskListRunsArgsValidator.Check([{ limit: 1.5 }])).toBe(false);
  });

  it('校验任务输出读取结果：接受 raw/review 信封，拒绝错字段，并允许 API 语义上的 null', () => {
    expect(TaskReadRunOutputResultValidator.Check({ kind: 'raw', runId: 'r1', rawText: 'text' })).toBe(true);
    expect(TaskReadRunOutputResultValidator.Check({ kind: 'review', runId: 'r2', output: { issues: [] } })).toBe(true);
    expect(TaskReadRunOutputResultValidator.Check({ kind: 'review', runId: 'r2', rawText: 'wrong' })).toBe(false);

    expect(TaskReadRunOutputResponseValidator.Check(null)).toBe(true);
    expect(TaskReadRunOutputResponseValidator.Check({ kind: 'raw', runId: 'r3', rawText: 'next' })).toBe(true);
    expect(TaskReadRunOutputResponseValidator.Check({ kind: 'raw', runId: 'r3' })).toBe(false);
  });

  it('校验运行列表结果：接受合法记录列表与诊断信息', () => {
    expect(
      AgentRunsListResultValidator.Check({
        records: [
          {
            id: 'run-1',
            personaId: 'continuity-reviewer',
            execution: 'task',
            trigger: 'ui-action',
            promptTemplateHash: 'abc',
            inputDigest: { brief: 'x' },
            memoryRefs: [],
            status: 'success',
            usage: { inputTokens: 1, outputTokens: 2 },
            createdAt: '2026-07-27T00:00:00.000Z'
          }
        ],
        diagnostics: []
      })
    ).toBe(true);

    // 可选字段齐全 + 诊断条目也应通过。
    expect(
      AgentRunsListResultValidator.Check({
        records: [
          {
            id: 'run-2',
            personaId: 'p',
            execution: 'chat',
            trigger: 'delegate',
            parentSessionId: 's1',
            promptTemplateHash: 'h',
            inputDigest: { files: ['a.md'], packId: 'pack-1' },
            outputRef: '.chaptale/runs/outputs/run-2.json',
            memoryRefs: ['m1'],
            status: 'timeout',
            usage: { inputTokens: 0, outputTokens: 0 },
            createdAt: '2026-07-27T00:00:00.000Z',
            completedAt: '2026-07-27T00:01:00.000Z'
          }
        ],
        diagnostics: [{ filePath: 'C:/w/.chaptale/runs/agent-runs-2026-07.jsonl', line: 3, message: '坏行' }]
      })
    ).toBe(true);
  });

  it('校验运行列表结果：拒绝缺失 status 的记录与未知枚举值', () => {
    expect(AgentRunsListResultValidator.Check({ records: [{ id: 'run-1' }], diagnostics: [] })).toBe(false);
    expect(
      AgentRunsListResultValidator.Check({
        records: [
          {
            id: 'run-1',
            personaId: 'p',
            execution: 'batch',
            trigger: 'user',
            promptTemplateHash: 'h',
            inputDigest: {},
            memoryRefs: [],
            status: 'success',
            usage: { inputTokens: 1, outputTokens: 2 },
            createdAt: '2026-07-27T00:00:00.000Z'
          }
        ],
        diagnostics: []
      })
    ).toBe(false);
  });

  it('校验 todo 清单查询参数：仅接受非空 sessionId', () => {
    expect(TodosGetArgsValidator.Check(['session-1'])).toBe(true);
    expect(TodosGetArgsValidator.Check([''])).toBe(false);
    expect(TodosGetArgsValidator.Check([])).toBe(false);
    expect(TodosGetArgsValidator.Check([1])).toBe(false);
  });

  it('校验授权决策参数：三类决策各自的字段约束', () => {
    expect(PermissionsDecideArgsValidator.Check(decideArgs({ outcome: 'allow-once' }))).toBe(true);
    expect(
      PermissionsDecideArgsValidator.Check(
        decideArgs({ outcome: 'allow-always', scope: 'workspace', pattern: 'write' })
      )
    ).toBe(true);
    expect(PermissionsDecideArgsValidator.Check(decideArgs({ outcome: 'deny', reason: '路径不对' }))).toBe(true);
    expect(PermissionsDecideArgsValidator.Check(decideArgs({ outcome: 'deny' }))).toBe(true);

    // allow-always 缺 pattern、非法 scope、未知 outcome 均拒绝。
    expect(PermissionsDecideArgsValidator.Check(decideArgs({ outcome: 'allow-always', scope: 'workspace' }))).toBe(
      false
    );
    expect(
      PermissionsDecideArgsValidator.Check(decideArgs({ outcome: 'allow-always', scope: 'everywhere', pattern: 'x' }))
    ).toBe(false);
    expect(PermissionsDecideArgsValidator.Check(decideArgs({ outcome: 'maybe' }))).toBe(false);
    expect(PermissionsDecideArgsValidator.Check([{ requestId: '', decision: { outcome: 'allow-once' } }])).toBe(false);

    expect(PermissionsPendingArgsValidator.Check(['session-1'])).toBe(true);
    expect(PermissionsPendingArgsValidator.Check([''])).toBe(false);

    expect(PermissionsListRulesArgsValidator.Check([])).toBe(true);
    expect(PermissionsListRulesArgsValidator.Check(['unexpected'])).toBe(false);
    expect(PermissionsRemoveRuleArgsValidator.Check([{ scope: 'workspace', pattern: 'write', action: 'allow' }])).toBe(
      true
    );
    expect(PermissionsRemoveRuleArgsValidator.Check([{ scope: 'global', pattern: 'bash(rm *)', action: 'deny' }])).toBe(
      true
    );
    expect(PermissionsRemoveRuleArgsValidator.Check([{ scope: 'session', pattern: 'write', action: 'allow' }])).toBe(
      false
    );
    expect(PermissionsRemoveRuleArgsValidator.Check([{ scope: 'workspace', pattern: '', action: 'allow' }])).toBe(
      false
    );
  });

  it('agent 会话压缩参数校验', () => {
    expect(AgentGetContextPressureArgsValidator.Check(['session-1'])).toBe(true);
    expect(AgentGetContextPressureArgsValidator.Check([''])).toBe(false);
    expect(AgentGetContextPressureArgsValidator.Check([])).toBe(false);

    expect(AgentCompactSessionArgsValidator.Check(['session-1'])).toBe(true);
    expect(AgentCompactSessionArgsValidator.Check([''])).toBe(false);
    expect(AgentCompactSessionArgsValidator.Check(['session-1', 'extra'])).toBe(false);
  });

  it('memory pending 参数校验', () => {
    expect(MemoryListPendingArgsValidator.Check([])).toBe(true);
    expect(MemoryListPendingArgsValidator.Check(['unexpected'])).toBe(false);

    expect(MemoryResolvePendingArgsValidator.Check([{ id: 'p-1', action: 'accept' }])).toBe(true);
    expect(MemoryResolvePendingArgsValidator.Check([{ id: 'p-1', action: 'reject' }])).toBe(true);
    expect(MemoryResolvePendingArgsValidator.Check([{ id: '', action: 'accept' }])).toBe(false);
    expect(MemoryResolvePendingArgsValidator.Check([{ id: 'p-1', action: 'apply' }])).toBe(false);
    expect(MemoryResolvePendingArgsValidator.Check([{ id: 'p-1', action: 'accept', extra: 1 }])).toBe(false);
  });
});
