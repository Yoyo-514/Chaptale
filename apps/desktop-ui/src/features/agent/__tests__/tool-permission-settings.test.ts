import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCreationStore } from '@/features/creation';

import ToolPermissionSettings from '../settings/ToolPermissionSettings.vue';
import { useAgentStore } from '../store';

afterEach(() => {
  delete window.chaptaleDesktop;
});

describe('全局设置中的作品工具授权管理', () => {
  it('按作品分组展示作品级授权（含回收站作品标记）并支持撤销', async () => {
    const agentRequest = vi.fn().mockResolvedValue(undefined);
    const creationRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'listTrashedWorks') {
        return Promise.resolve({
          ok: true,
          value: [{ id: 'work-trashed', title: '旧稿残卷', kind: 'novel', trashedAt: 1000 }]
        });
      }
      return Promise.resolve({ ok: true, value: [] });
    });
    window.chaptaleDesktop = {
      agentHost: { request: agentRequest, subscribe: () => () => {} },
      creation: { request: creationRequest, subscribe: () => () => {} }
    } as any;

    const pinia = createPinia();
    setActivePinia(pinia);
    const creation = useCreationStore();
    creation.works = [{ id: 'work-active', title: '长夜行', kind: 'novel', createdAt: 1, updatedAt: 2 }];

    const agent = useAgentStore();
    agent.connected = true;
    agent.state = {
      cursor: 1,
      tools: [],
      models: [],
      approvals: [],
      sessions: [],
      settings: {
        defaultInstructions: [],
        namedInstructions: [],
        defaultMode: 'review',
        lastModel: null,
        toolPermissions: [
          {
            id: 'perm-1',
            scope: { kind: 'work', workId: 'work-active' },
            capability: 'fs_read',
            path: 'D:\\史料\\明史',
            pathKind: 'directory'
          },
          {
            id: 'perm-2',
            scope: { kind: 'work', workId: 'work-trashed' },
            capability: 'fs_read',
            path: 'D:\\note.txt',
            pathKind: 'file'
          },
          {
            id: 'perm-session',
            scope: { kind: 'session', sessionId: 's-1' },
            capability: 'fs_read',
            path: 'D:\\忽略会话级',
            pathKind: 'directory'
          }
        ]
      }
    };

    const wrapper = mount(ToolPermissionSettings, { global: { plugins: [pinia] } });
    await flushPromises();

    const groups = wrapper.findAll('.permission-work-group');
    expect(groups).toHaveLength(2);
    expect(groups[0]!.text()).toContain('长夜行');
    expect(groups[0]!.text()).toContain('允许读取目录');
    expect(groups[0]!.text()).toContain('D:\\史料\\明史');

    expect(groups[1]!.text()).toContain('旧稿残卷');
    expect(groups[1]!.text()).toContain('回收站');
    expect(groups[1]!.text()).toContain('允许读取文件');
    expect(groups[1]!.text()).toContain('D:\\note.txt');
    expect(wrapper.text()).not.toContain('D:\\忽略会话级');

    await groups[0]!.get('button').trigger('click');
    await flushPromises();
    expect(agentRequest).toHaveBeenCalledWith('revokeToolPermission', { id: 'perm-1' });
    wrapper.unmount();
  });
});
