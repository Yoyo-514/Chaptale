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
    sessionId: 'session',
    file: 'history.jsonl',
    running: true,
    compacting: true,
    instructions: [],
    mode: 'review',
    messages: [],
    model: { provider: 'offline', id: 'model' }
  };
  agent.state = {
    cursor: 1,
    tools: [],
    approvals: [],
    sessions: [session],
    models: [{ provider: 'offline', id: 'model', name: '离线模型' }],
    settings: { defaultInstructions: [], defaultMode: 'review', lastModel: null, namedInstructions: [] }
  };
  agent.connected = true;
  agent.activeId = session.id;
  agent.draft = '继续创作的草稿';
  wrapper = mount(MessageComposer, { global: { plugins: [pinia] } });
  expect(wrapper.get('[role="status"]').text()).toBe('正在压缩…');
  expect(wrapper.get('button[aria-label="停止压缩"]').attributes('disabled')).toBeUndefined();
  expect(wrapper.find('button[type="submit"]').exists()).toBe(false);
  expect(wrapper.get('[aria-label="会话模型"]').attributes('disabled')).toBeDefined();
  await wrapper.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true });
  await flushPromises();
  expect(agent.draft).toBe('继续创作的草稿');
  agent.state.sessions[0].compacting = false;
  await flushPromises();
  expect(wrapper.find('button[type="submit"]').exists()).toBe(false);
  expect(wrapper.find('button[aria-label="停止生成"]').exists()).toBe(true);
  expect(wrapper.get('textarea').attributes('placeholder')).toContain('Ctrl + Enter 插话');
  agent.state.sessions[0].running = false;
  await flushPromises();
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined();
  expect(wrapper.get('[aria-label="会话模型"]').attributes('disabled')).toBeUndefined();
});
