import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SessionSettings from '../components/SessionSettings.vue';
import { useAgentStore } from '../store';

afterEach(() => {
  delete window.chaptaleDesktop;
});

describe('会话设置内的本会话工具授权撤销', () => {
  it('仅展示当前打开会话的目录外授权规则并可逐条撤销', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    window.chaptaleDesktop = {
      agentHost: { request, subscribe: () => () => {} }
    } as any;

    const pinia = createPinia();
    setActivePinia(pinia);
    const agent = useAgentStore();
    agent.connected = true;
    agent.activeId = 'session-a';
    agent.state = {
      cursor: 1,
      tools: [],
      models: [],
      approvals: [],
      sessions: [
        {
          id: 'session-a',
          sessionId: 'session-a',
          file: 'a.jsonl',
          workId: null,
          running: false,
          compacting: false,
          instructions: [],
          mode: 'review',
          messages: []
        }
      ],
      settings: {
        defaultInstructions: [],
        namedInstructions: [],
        defaultMode: 'review',
        lastModel: null,
        toolPermissions: [
          {
            id: 'perm-session-a',
            scope: { kind: 'session', sessionId: 'session-a' },
            capability: 'fs_read',
            path: 'D:\\参考书\\明史',
            pathKind: 'directory'
          },
          {
            id: 'perm-session-b',
            scope: { kind: 'session', sessionId: 'session-b' },
            capability: 'fs_read',
            path: 'D:\\其他会话',
            pathKind: 'directory'
          },
          {
            id: 'perm-work-1',
            scope: { kind: 'work', workId: 'work-1' },
            capability: 'fs_read',
            path: 'D:\\作品共享',
            pathKind: 'directory'
          }
        ]
      }
    };

    const wrapper = mount(SessionSettings, { global: { plugins: [pinia] } });
    // 授权列表默认收起，只显示一行摘要。
    expect(wrapper.findAll('.agent-session-permission-item')).toHaveLength(0);
    const summary = wrapper.findAll('button').find(button => button.text().includes('已允许 1 处'))!;
    await summary.trigger('click');
    const items = wrapper.findAll('.agent-session-permission-item');
    expect(items).toHaveLength(1);
    expect(items[0]!.text()).toContain('读取目录');
    expect(items[0]!.text()).toContain('D:\\参考书\\明史');

    await items[0]!.get('button').trigger('click');
    await flushPromises();
    expect(request).toHaveBeenCalledWith('revokeToolPermission', { id: 'perm-session-a' });
    wrapper.unmount();
  });
});
