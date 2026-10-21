import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, expect, it } from 'vitest';

import type { SessionView } from '@chaptale/agent-host/protocol';

import MessageComposer from '../components/MessageComposer.vue';
import { useAgentStore } from '../store';

let wrapper: ReturnType<typeof mount>;
afterEach(() => {
  wrapper?.unmount();
  localStorage.clear();
});

it('压缩期间保留草稿并禁用发送和切换模型，停止按钮明确指向压缩', async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const agent = useAgentStore();
  const session: SessionView = {
    id: 'session',
    file: 'history.jsonl',
    cwd: 'work',
    running: true,
    compacting: true,
    instructions: [],
    mode: 'review',
    messages: [],
    model: { provider: 'offline', id: 'model' }
  };
  agent.state = {
    cursor: 1,
    cwd: 'work',
    tools: [],
    approvals: [],
    sessions: [session],
    models: [{ provider: 'offline', id: 'model', name: '离线模型' }],
    settings: { defaultInstructions: [], defaultMode: 'review', namedInstructions: [] }
  };
  agent.connected = true;
  agent.select(session.id);
  agent.draft = '继续创作的草稿';
  wrapper = mount(MessageComposer, { global: { plugins: [pinia] } });
  expect(wrapper.get('[role="status"]').text()).toBe('正在压缩…');
  expect(wrapper.get('button[aria-label="停止压缩"]').attributes('disabled')).toBeUndefined();
  expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
  expect(wrapper.get('[aria-label="会话模型"]').attributes('disabled')).toBeDefined();
  await wrapper.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true });
  await flushPromises();
  expect(agent.draft).toBe('继续创作的草稿');
  agent.state.sessions[0].running = false;
  agent.state.sessions[0].compacting = false;
  await flushPromises();
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined();
  expect(wrapper.get('[aria-label="会话模型"]').attributes('disabled')).toBeUndefined();
});
