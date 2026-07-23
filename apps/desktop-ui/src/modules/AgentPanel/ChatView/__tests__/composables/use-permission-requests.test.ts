import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

import type { PermissionAskEvent } from '@chaptale/ipc-contract';

import { useNotificationStore } from '@/stores/notification';
import { usePermissionRequests } from '../../composables/usePermissionRequests';

const request: PermissionAskEvent = {
  requestId: 'permission-1',
  sessionId: 'session-1',
  toolName: 'write',
  riskLevel: 'mutating',
  subject: 'src/example.ts'
};

function installDesktopMock(decide: ReturnType<typeof vi.fn>) {
  const permissions = {
    getPending: vi.fn().mockResolvedValue([request]),
    decide,
    onAsk: vi.fn().mockReturnValue(vi.fn())
  };

  window.chaptaleDesktop = { permissions } as unknown as NonNullable<typeof window.chaptaleDesktop>;
  return permissions;
}

async function mountPermissionRequests() {
  let permissionRequests!: ReturnType<typeof usePermissionRequests>;
  const wrapper = mount(
    defineComponent({
      setup() {
        permissionRequests = usePermissionRequests(() => 'session-1');
        return () => null;
      }
    })
  );

  await vi.waitFor(() => expect(permissionRequests.requests.value).toEqual([request]));
  return { permissionRequests, wrapper };
}

beforeEach(() => {
  setActivePinia(createPinia());
  delete window.chaptaleDesktop;
  vi.restoreAllMocks();
});

describe('usePermissionRequests', () => {
  it('notifies where an accepted workspace rule is saved', async () => {
    installDesktopMock(vi.fn().mockResolvedValue({ accepted: true }));
    const { permissionRequests, wrapper } = await mountPermissionRequests();

    await permissionRequests.decide({
      requestId: request.requestId,
      decision: { outcome: 'allow-always', scope: 'workspace', pattern: 'write' }
    });

    expect(permissionRequests.requests.value).toHaveLength(0);
    expect(useNotificationStore().items.at(-1)).toMatchObject({
      kind: 'success',
      title: '已添加工作区授权规则',
      description: 'write · 保存于 .chaptale/permissions.json'
    });
    wrapper.unmount();
  });

  it('removes an expired request and reports that it was not accepted', async () => {
    installDesktopMock(vi.fn().mockResolvedValue({ accepted: false }));
    const { permissionRequests, wrapper } = await mountPermissionRequests();

    await permissionRequests.decide({ requestId: request.requestId, decision: { outcome: 'allow-once' } });

    expect(permissionRequests.requests.value).toHaveLength(0);
    expect(useNotificationStore().items.at(-1)).toMatchObject({ kind: 'info', title: '授权请求已失效' });
    wrapper.unmount();
  });

  it('keeps the request available for retry when submission fails', async () => {
    installDesktopMock(vi.fn().mockRejectedValue(new Error('disk unavailable')));
    const { permissionRequests, wrapper } = await mountPermissionRequests();

    await permissionRequests.decide({ requestId: request.requestId, decision: { outcome: 'allow-once' } });

    expect(permissionRequests.requests.value).toEqual([request]);
    expect(useNotificationStore().items.at(-1)).toMatchObject({
      kind: 'error',
      title: '提交授权决定失败',
      description: 'disk unavailable'
    });
    wrapper.unmount();
  });
});
