import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionRuleEntry } from '@chaptale/ipc-contract';

import { AppAlertDialog } from '@/components/AppDialog';
import { useNotificationStore } from '@/stores/notification';

import PermissionsSettings from '../../sections/PermissionsSettings.vue';

const initialRules: PermissionRuleEntry[] = [
  { scope: 'workspace', pattern: 'write(src/example.ts)', action: 'allow' },
  { scope: 'global', pattern: 'bash(rm *)', action: 'deny' }
];

function installDesktopMock(options?: { removeRejects?: boolean }) {
  const permissions = {
    listRules: vi.fn().mockResolvedValue(initialRules),
    removeRule: options?.removeRejects
      ? vi.fn().mockRejectedValue(new Error('disk unavailable'))
      : vi.fn().mockResolvedValue([initialRules[0]])
  };

  window.chaptaleDesktop = { permissions } as unknown as NonNullable<typeof window.chaptaleDesktop>;
  return permissions;
}

beforeEach(() => {
  setActivePinia(createPinia());
  delete window.chaptaleDesktop;
  vi.restoreAllMocks();
});

describe('PermissionsSettings', () => {
  it('loads persisted workspace and global rules and removes a global rule after confirmation', async () => {
    const permissions = installDesktopMock();
    permissions.removeRule.mockImplementation(async rule => {
      expect(() => structuredClone(rule)).not.toThrow();
      return [initialRules[0]];
    });
    const wrapper = mount(PermissionsSettings);

    await vi.waitFor(() => expect(permissions.listRules).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(wrapper.text()).toContain('write(src/example.ts)'));
    expect(wrapper.text()).toContain('bash(rm *)');
    expect(wrapper.findAllComponents(AppAlertDialog)).toHaveLength(1);

    await wrapper.get('button[aria-label="删除全局规则 bash(rm *)"]').trigger('click');
    const dialog = wrapper.getComponent(AppAlertDialog);
    expect(dialog.props('open')).toBe(true);
    expect(dialog.props('title')).toBe('删除这条全局权限规则？');

    dialog.vm.$emit('confirm');
    await vi.waitFor(() =>
      expect(permissions.removeRule).toHaveBeenCalledWith({ scope: 'global', pattern: 'bash(rm *)', action: 'deny' })
    );
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('bash(rm *)'));
    expect(useNotificationStore().items.at(-1)).toMatchObject({ kind: 'success', title: '权限规则已删除' });
  });

  it('keeps the rule visible and reports an error when removal fails', async () => {
    const permissions = installDesktopMock({ removeRejects: true });
    const wrapper = mount(PermissionsSettings);

    await vi.waitFor(() => expect(wrapper.text()).toContain('write(src/example.ts)'));
    await wrapper.get('button[aria-label="删除本工作区规则 write(src/example.ts)"]').trigger('click');
    wrapper.getComponent(AppAlertDialog).vm.$emit('confirm');

    await vi.waitFor(() => expect(permissions.removeRule).toHaveBeenCalledOnce());
    expect(wrapper.text()).toContain('write(src/example.ts)');
    expect(useNotificationStore().items.at(-1)).toMatchObject({
      kind: 'error',
      title: '删除权限规则失败',
      description: 'disk unavailable'
    });
  });
});
