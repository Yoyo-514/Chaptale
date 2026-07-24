import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

import { useNotificationStore } from '@/stores/notification';

import { useContextCompaction } from '../../composables/useContextCompaction';

const pressure = {
  tokens: 72_000,
  contextWindow: 100_000,
  percent: 72,
  thresholdPercent: 70,
  shouldPrompt: true
};

function installDesktopMock() {
  const agent = {
    getContextPressure: vi.fn().mockResolvedValue(pressure),
    compactSession: vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      tokensBefore: 72_000,
      estimatedTokensAfter: 18_000,
      summaryRef: '.chaptale/memory/summaries/compactions/summary.md'
    })
  };

  window.chaptaleDesktop = { agent } as unknown as NonNullable<typeof window.chaptaleDesktop>;
  return agent;
}

beforeEach(() => {
  setActivePinia(createPinia());
  delete window.chaptaleDesktop;
  vi.restoreAllMocks();
});

describe('useContextCompaction', () => {
  it('loads the current session pressure and lets the author defer the prompt', async () => {
    const agent = installDesktopMock();
    const sessionId = ref('session-1');
    let state!: ReturnType<typeof useContextCompaction>;
    const wrapper = mount(
      defineComponent({
        setup() {
          state = useContextCompaction(() => sessionId.value, vi.fn());
          return () => null;
        }
      })
    );

    await vi.waitFor(() => expect(state.shouldShow.value).toBe(true));
    expect(agent.getContextPressure).toHaveBeenCalledWith('session-1');

    state.dismiss();
    expect(state.shouldShow.value).toBe(false);
    wrapper.unmount();
  });

  it('compacts after confirmation, reloads the session and reports the summary location', async () => {
    const agent = installDesktopMock();
    const onCompacted = vi.fn().mockResolvedValue(undefined);
    let state!: ReturnType<typeof useContextCompaction>;
    const wrapper = mount(
      defineComponent({
        setup() {
          state = useContextCompaction(() => 'session-1', onCompacted);
          return () => null;
        }
      })
    );

    await vi.waitFor(() => expect(state.shouldShow.value).toBe(true));
    await state.compact();

    expect(agent.compactSession).toHaveBeenCalledWith('session-1');
    expect(onCompacted).toHaveBeenCalledOnce();
    expect(state.shouldShow.value).toBe(false);
    expect(useNotificationStore().items.at(-1)).toMatchObject({
      kind: 'success',
      title: '会话已压缩',
      description: '摘要已保存到 .chaptale/memory/summaries/compactions/summary.md'
    });
    wrapper.unmount();
  });

  it('keeps the prompt visible and reports an error when compaction fails', async () => {
    const agent = installDesktopMock();
    agent.compactSession.mockRejectedValueOnce(new Error('模型不可用'));
    let state!: ReturnType<typeof useContextCompaction>;
    const wrapper = mount(
      defineComponent({
        setup() {
          state = useContextCompaction(() => 'session-1', vi.fn());
          return () => null;
        }
      })
    );

    await vi.waitFor(() => expect(state.shouldShow.value).toBe(true));
    await state.compact();

    expect(state.shouldShow.value).toBe(true);
    expect(useNotificationStore().items.at(-1)).toMatchObject({
      kind: 'error',
      title: '会话压缩失败',
      description: '模型不可用'
    });
    wrapper.unmount();
  });
});
