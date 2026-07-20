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

describe('TaskService', () => {
  it('rejects unknown persona ids', async () => {
    const { service } = createService({ personas: [] });

    await expect(service.start('ghost', 'b', '正文')).rejects.toThrow(/persona 不存在/);
  });

  it('rejects empty text without any context files', async () => {
    const { service } = createService();

    await expect(service.start('continuity-reviewer', 'b', '  ')).rejects.toThrow(/没有可审查的文本/);
  });

  it('resolves context files and passes the envelope to the runner', async () => {
    const { service, taskRunner, contextFileService } = createService();

    const handle = await service.start('continuity-reviewer', '审查', '', ['/a.md', '/b.md']);
    await handle.promise;

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

    const handle = await service.start('continuity-reviewer', '审查', '正文');
    await handle.promise;

    expect(contextFileService.resolve).not.toHaveBeenCalled();
    expect(taskRunner.run).toHaveBeenCalledWith(expect.objectContaining({ contextPrompt: undefined }));
  });

  it('cancel aborts the matching run only', async () => {
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

    const first = await service.start('continuity-reviewer', 'b', '正文');
    const second = await service.start('continuity-reviewer', 'b', '正文');

    service.cancel(first.runId);

    expect(capturedSignals[0]?.aborted).toBe(true);
    expect(capturedSignals[1]?.aborted).toBe(false);

    service.cancel(second.runId);
    service.cancel('不存在的 runId');

    expect(capturedSignals[1]?.aborted).toBe(true);
  });
});
