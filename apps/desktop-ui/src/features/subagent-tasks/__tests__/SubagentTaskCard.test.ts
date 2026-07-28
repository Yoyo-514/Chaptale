import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SubagentTaskCard from '../components/SubagentTaskCard.vue';

function createTask(overrides = {}) {
  return {
    requestId: 'req-1',
    personaId: 'continuity-reviewer',
    state: 'success' as const,
    outputRef: '.chaptale/runs/outputs/run-1.json',
    ...overrides
  };
}

function installDesktopMock(readRunOutput: (outputRef: string) => Promise<unknown>) {
  const tasks = {
    readRunOutput: vi.fn(readRunOutput)
  };

  window.chaptaleDesktop = { tasks } as unknown as NonNullable<typeof window.chaptaleDesktop>;
  return tasks;
}

function mountCard(tasks = [createTask()]) {
  return mount(SubagentTaskCard, {
    props: { tasks },
    global: {
      stubs: {
        AppButton: {
          template: '<button type="button"><slot /></button>'
        },
        AppScrollArea: {
          template: '<div><slot /></div>'
        }
      }
    }
  });
}

describe('SubagentTaskCard', () => {
  beforeEach(() => {
    delete window.chaptaleDesktop;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.chaptaleDesktop;
  });

  it('为 raw 信封展示 rawText 原文', async () => {
    const tasks = installDesktopMock(async () => ({ kind: 'raw', runId: 'run-1', rawText: 'raw output text' }));
    const wrapper = mountCard();

    await wrapper.find('button').trigger('click');
    await flushPromises();

    expect(tasks.readRunOutput).toHaveBeenCalledWith('.chaptale/runs/outputs/run-1.json');
    expect(wrapper.find('.subagent-output').text()).toBe('raw output text');
  });

  it('为 review 信封展示结构化 payload 的 JSON 诊断文本', async () => {
    installDesktopMock(async () => ({ kind: 'review', runId: 'run-2', output: { issues: [{ message: '缺少主语' }] } }));
    const wrapper = mountCard([createTask({ requestId: 'req-2', outputRef: '.chaptale/reviews/run-2.json' })]);

    await wrapper.find('button').trigger('click');
    await flushPromises();

    expect(wrapper.find('.subagent-output').text()).toBe(
      JSON.stringify({ issues: [{ message: '缺少主语' }] }, null, 2)
    );
  });

  it('在结果不可读时展示不可读提示', async () => {
    installDesktopMock(async () => null);
    const wrapper = mountCard([createTask({ requestId: 'req-3', outputRef: '.chaptale/reviews/run-3.json' })]);

    await wrapper.find('button').trigger('click');
    await flushPromises();

    expect(wrapper.find('.subagent-output').text()).toBe('（结果文件不可读）');
  });

  it('在读取结果 reject 时回退为不可读提示且不产生未处理拒绝', async () => {
    const onUnhandledRejection = vi.fn();
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    installDesktopMock(async () => {
      throw new Error('read failed');
    });
    const wrapper = mountCard([createTask({ requestId: 'req-4', outputRef: '.chaptale/reviews/run-4.json' })]);

    await wrapper.find('button').trigger('click');
    await flushPromises();

    expect(wrapper.find('.subagent-output').text()).toBe('（结果文件不可读）');
    expect(onUnhandledRejection).not.toHaveBeenCalled();

    window.removeEventListener('unhandledrejection', onUnhandledRejection);
  });
});
