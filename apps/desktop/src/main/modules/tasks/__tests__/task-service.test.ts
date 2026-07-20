import { describe, expect, it, vi } from 'vitest';

import type { PersonaDefinition } from '@chaptale/shared';

import { TaskService } from '../service';

const taskPersona: PersonaDefinition = {
  id: 'continuity-reviewer',
  name: '连贯性审查',
  type: 'review',
  execution: 'task',
  output: 'continuity-issues',
  body: '你是审查专员。',
  source: 'builtin'
};

function createService(options: { personas?: PersonaDefinition[]; runResult?: object } = {}) {
  const settingsService = { getCurrentCwd: vi.fn(async () => '/cwd') };
  const personaRegistry = {
    load: vi.fn(async () => ({ personas: options.personas ?? [taskPersona], diagnostics: [] }))
  };
  const taskRunner = {
    run: vi.fn(async () => options.runResult ?? { status: 'cancelled', runId: 'r1' })
  };
  const contextFileService = {
    resolve: vi.fn(async () => ({
      promptPrefix: '<attached_context_files>\n内容\n</attached_context_files>\n\n',
      images: [],
      imagePaths: []
    }))
  };

  const service = new TaskService({
    settingsService: settingsService as any,
    personaRegistry: personaRegistry as any,
    taskRunner: taskRunner as any,
    contextFileService
  });

  return { service, taskRunner, contextFileService };
}

function startRequest(overrides: Partial<Parameters<TaskService['start']>[0]> = {}) {
  return {
    requestId: 'req-1',
    personaId: 'continuity-reviewer',
    brief: '审查',
    text: '正文',
    ...overrides
  };
}

describe('TaskService', () => {
  it('rejects unknown persona ids', async () => {
    const { service } = createService({ personas: [] });

    await expect(service.start(startRequest({ personaId: 'ghost' }))).rejects.toThrow(/persona 不存在/);
  });

  it('rejects empty text without any context files', async () => {
    const { service } = createService();

    await expect(service.start(startRequest({ text: '  ' }))).rejects.toThrow(/没有可审查的文本/);
  });

  it('returns the runner result with its runId untouched', async () => {
    const { service } = createService({
      runResult: { status: 'success', runId: 'run-9', output: { issues: [] }, outputRef: 'ref' }
    });

    await expect(service.start(startRequest())).resolves.toEqual({
      status: 'success',
      runId: 'run-9',
      output: { issues: [] },
      outputRef: 'ref'
    });
  });

  it('resolves context files and passes the envelope to the runner', async () => {
    const { service, taskRunner, contextFileService } = createService();

    await service.start(startRequest({ text: '', contextFilePaths: ['/a.md', '/b.md'] }));

    expect(contextFileService.resolve).toHaveBeenCalledWith(['/a.md', '/b.md']);
    expect(taskRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '',
        contextPrompt: expect.stringContaining('<attached_context_files>')
      })
    );
  });

  it('skips context resolution when no files are attached', async () => {
    const { service, taskRunner, contextFileService } = createService();

    await service.start(startRequest());

    expect(contextFileService.resolve).not.toHaveBeenCalled();
    expect(taskRunner.run).toHaveBeenCalledWith(expect.objectContaining({ contextPrompt: undefined }));
  });

  it('rejects a duplicate requestId while the first run is still active', async () => {
    const settingsService = { getCurrentCwd: vi.fn(async () => '/cwd') };
    const personaRegistry = { load: vi.fn(async () => ({ personas: [taskPersona], diagnostics: [] })) };
    const taskRunner = { run: vi.fn(() => new Promise(() => undefined)) };
    const service = new TaskService({
      settingsService: settingsService as any,
      personaRegistry: personaRegistry as any,
      taskRunner: taskRunner as any
    });

    void service.start(startRequest());
    // 等待第一个 start 完成注册（persona 加载是异步的）。
    await vi.waitFor(() => expect(taskRunner.run).toHaveBeenCalledOnce());

    await expect(service.start(startRequest())).rejects.toThrow(/重复的任务请求/);
  });

  it('cancel aborts the matching request only', async () => {
    const settingsService = { getCurrentCwd: vi.fn(async () => '/cwd') };
    const personaRegistry = { load: vi.fn(async () => ({ personas: [taskPersona], diagnostics: [] })) };
    const capturedSignals: AbortSignal[] = [];
    const taskRunner = {
      run: vi.fn((request: { signal?: AbortSignal }) => {
        if (request.signal) capturedSignals.push(request.signal);
        return new Promise(() => undefined);
      })
    };
    const service = new TaskService({
      settingsService: settingsService as any,
      personaRegistry: personaRegistry as any,
      taskRunner: taskRunner as any
    });

    void service.start(startRequest({ requestId: 'req-a' }));
    void service.start(startRequest({ requestId: 'req-b' }));
    await vi.waitFor(() => expect(capturedSignals).toHaveLength(2));

    service.cancel('req-a');

    expect(capturedSignals[0]?.aborted).toBe(true);
    expect(capturedSignals[1]?.aborted).toBe(false);

    service.cancel('不存在的 requestId');
    expect(capturedSignals[1]?.aborted).toBe(false);
  });
});
