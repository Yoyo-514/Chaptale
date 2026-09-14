import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ChatSlashCommandMenu from '../../components/ChatInput/ChatSlashCommandMenu.vue';

describe('命令菜单', () => {
  it('click 激活命令，保留键盘和触屏的原生按钮语义', async () => {
    const command = {
      name: 'settings',
      description: '设置',
      source: 'app' as const,
      behavior: 'client-action' as const
    };
    const wrapper = mount(ChatSlashCommandMenu, { props: { commands: [command], selectedIndex: 0 } });
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('select')).toEqual([[command]]);
    wrapper.unmount();
  });
});
