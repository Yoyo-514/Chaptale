import { flushPromises, mount } from '@vue/test-utils';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHostApplication } from '@chaptale/agent-host/application';
import type { HostCommand, HostCommands, ManagedMcpServerView } from '@chaptale/agent-host/protocol';
import { CreationApplication } from '@chaptale/creation/application';
import type { ChaptaleDesktopApi } from '@chaptale/desktop/bridge';
import { openCreationStorage } from '@chaptale/storage';

import { AppSelect } from '@/components/AppSelect';
import { useCreationStore } from '@/features/creation';

import SettingsSidebar from '../components/SettingsSidebar.vue';
import McpServerRow from '../sections/mcp/McpServerRow.vue';
import McpSettings from '../sections/McpSettings.vue';
import { useSettingsStore } from '../store';

/** 只应答握手、工具列表的最小 stdio MCP 服务；声明资源能力。 */
const MCP_SERVER_SCRIPT = `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = message => process.stdout.write(JSON.stringify(message) + '\\n');
rl.on('line', line => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'wiki', version: '1.0.0' }
      }
    });
  } else if (message.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [{ name: 'search', description: '检索词条', inputSchema: { type: 'object', properties: {} } }]
      }
    });
  } else {
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
  }
});
`;

describe('设置面板中的 MCP 服务页', () => {
  let root: string | undefined;

  afterEach(async () => {
    delete (window as { chaptaleDesktop?: unknown }).chaptaleDesktop;
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it('保存配置后连接服务并显示状态，启停与暴露方式写入当前查看的层级，作品页的调整不影响全局', async () => {
    root = await mkdtemp(join(tmpdir(), 'chaptale-mcp-settings-'));
    const creation = new CreationApplication(await openCreationStorage({ rootDir: join(root, 'creation') }));
    const host = await createHostApplication({
      cwd: join(root, 'work'),
      agentDir: join(root, 'agent'),
      configDir: join(root, 'config'),
      sessionDir: join(root, 'sessions'),
      settingsFile: join(root, 'config', 'settings.json'),
      creation
    });
    const createdWork = creation.executeAuthor({
      method: 'createWork',
      input: { commandId: randomUUID(), title: '山海卷', kind: 'novel' }
    });
    if (!createdWork.ok) throw new Error(createdWork.error.message);
    const work = createdWork.value;
    const script = join(root, 'wiki-server.cjs');
    await writeFile(script, MCP_SERVER_SCRIPT, 'utf8');

    const agentClient: ChaptaleDesktopApi['agentHost'] = {
      request: async <K extends keyof HostCommands>(method: K, input: HostCommands[K]['input']) =>
        (await host.execute({ method, input: structuredClone(input) } as HostCommand)) as HostCommands[K]['output'],
      subscribe: listener => host.subscribe(listener),
      onDisconnected: () => () => {}
    };
    Object.defineProperty(window, 'chaptaleDesktop', {
      configurable: true,
      value: {
        agentHost: agentClient,
        creation: {
          request: (method: string, input: unknown) => creation.execute({ method, input } as never),
          subscribe: (listener: (event: unknown) => void) => creation.subscribe(listener as never),
          onDisconnected: () => () => {}
        }
      }
    });
    const servers = async (workId: string | null) =>
      (await host.execute({ method: 'getMcpState', input: { workId } })) as HostCommands['getMcpState']['output'];

    try {
      const pinia = createPinia();
      setActivePinia(pinia);
      const creationStore = useCreationStore();
      creationStore.works = [work];
      creationStore.state.activeWorkId = work.id;

      const sidebar = mount(SettingsSidebar, { global: { plugins: [pinia] } });
      await sidebar
        .findAll('button')
        .find(button => button.text().includes('MCP 服务'))!
        .trigger('click');
      expect(useSettingsStore().activeSection).toBe('mcp');
      sidebar.unmount();

      const wrapper = mount(McpSettings, { attachTo: document.body, global: { plugins: [pinia] } });
      const editor = () => wrapper.get('textarea[aria-label="mcp.json 内容"]');
      const button = (label: string) => wrapper.findAll('button').find(item => item.text() === label);
      await vi.waitFor(() => expect(wrapper.text()).toContain('还没有服务'));

      // 校验不通过的配置不落盘，草稿留在编辑区，可放弃修改
      const before = (editor().element as HTMLTextAreaElement).value;
      await editor().setValue('{ "servers": {} }');
      await button('保存并连接')!.trigger('click');
      await vi.waitFor(() => expect(wrapper.text()).toContain('不支持的顶层字段'));
      expect((editor().element as HTMLTextAreaElement).value).toBe('{ "servers": {} }');
      await button('放弃修改')!.trigger('click');
      expect((editor().element as HTMLTextAreaElement).value).toBe(before);
      expect(button('放弃修改')).toBeUndefined();

      // 保存后由宿主推送连接状态：无需手动刷新即可看到已连接、工具与资源
      const json = JSON.stringify({ mcpServers: { wiki: { command: process.execPath, args: [script] } } }, null, 2);
      await editor().setValue(json);
      await button('保存并连接')!.trigger('click');
      await vi.waitFor(() => {
        expect(wrapper.text()).toContain('已连接，1 个工具');
        expect(wrapper.text()).toContain('提供资源');
      });
      expect(wrapper.text()).not.toContain('不支持的顶层字段');
      expect(button('放弃修改')).toBeUndefined();
      expect(wrapper.get('.mcp-tools').text()).toContain('search');
      expect(wrapper.get('.mcp-tools').text()).toContain('检索词条');

      // 全局页：停用、再启用、切换暴露方式都写入全局配置
      await wrapper.get('[aria-label="启用 MCP 服务 wiki"]').trigger('click');
      await vi.waitFor(() => expect(wrapper.text()).toContain('已停用'));
      expect((await servers(null)).servers[0]).toMatchObject({ enabled: false, state: 'disabled' });
      await wrapper.get('[aria-label="启用 MCP 服务 wiki"]').trigger('click');
      await vi.waitFor(() => expect(wrapper.text()).toContain('已连接，1 个工具'));

      wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 'direct');
      await vi.waitFor(async () => expect((await servers(null)).servers[0]!.exposure).toBe('direct'));
      expect((editor().element as HTMLTextAreaElement).value).toContain('"direct"');

      // 作品页：看到全局服务，停用它只写作品级覆盖
      await wrapper
        .findAll('[role="tab"]')
        .find(tab => tab.text() === '当前作品《山海卷》')!
        .trigger('mousedown', { button: 0 });
      await vi.waitFor(() => expect(wrapper.get('.mcp-row').text()).toContain('全局'));
      await wrapper.get('[aria-label="启用 MCP 服务 wiki"]').trigger('click');
      await vi.waitFor(() => expect(wrapper.get('.mcp-row').text()).toContain('已在本作品调整'));
      expect(wrapper.get('.mcp-row').text()).toContain('已停用');
      expect((await servers(work.id)).servers[0]).toMatchObject({ enabled: false, overriddenInWork: true });
      expect((await servers(null)).servers[0]).toMatchObject({ enabled: true, exposure: 'direct' });

      // 切回全局页仍是启用状态
      await wrapper
        .findAll('[role="tab"]')
        .find(tab => tab.text() === '全局')!
        .trigger('mousedown', { button: 0 });
      await vi.waitFor(() => expect(wrapper.get('.mcp-row').text()).toContain('已连接，1 个工具'));
      expect(wrapper.get('.mcp-row').text()).not.toContain('已在本作品调整');

      wrapper.unmount();
    } finally {
      await host.dispose();
      creation.close();
    }
  });

  it('远程服务按登录状态提供登录、粘贴跳转地址、取消登录与登出', async () => {
    const remote: ManagedMcpServerView = {
      name: 'docs',
      definedIn: 'global',
      transport: 'http',
      endpoint: 'https://mcp.example.com/mcp',
      enabled: true,
      exposure: 'codemode',
      state: 'needs-auth',
      tools: [],
      hasResources: false,
      usesOAuth: true,
      hasStoredAuth: false
    };
    const wrapper = mount(McpServerRow, { props: { server: remote, level: 'global', busy: false } });
    const button = (label: string) => wrapper.findAll('button').find(item => item.text() === label);

    expect(wrapper.text()).toContain('需要登录');
    expect(button('登出')).toBeUndefined();
    await button('登录')!.trigger('click');
    expect(wrapper.emitted('signIn')).toHaveLength(1);

    // 等待浏览器回跳期间：不再显示登录按钮，可粘贴地址或取消
    await wrapper.setProps({
      server: { ...remote, signingIn: { authorizationUrl: 'https://mcp.example.com/authorize' } }
    });
    expect(button('登录')).toBeUndefined();
    expect(button('提交地址')!.attributes('disabled')).toBeDefined();
    await wrapper.get('input').setValue('  http://127.0.0.1:53124/callback?code=abc  ');
    await button('提交地址')!.trigger('click');
    expect(wrapper.emitted('submitRedirect')).toEqual([['http://127.0.0.1:53124/callback?code=abc']]);
    await button('取消登录')!.trigger('click');
    expect(wrapper.emitted('cancelSignIn')).toHaveLength(1);

    // 已登录并连接：只剩登出与重连
    await wrapper.setProps({ server: { ...remote, state: 'connected', hasStoredAuth: true } });
    await flushPromises();
    expect(button('登录')).toBeUndefined();
    await button('登出')!.trigger('click');
    await button('重连')!.trigger('click');
    expect(wrapper.emitted('signOut')).toHaveLength(1);
    expect(wrapper.emitted('reconnect')).toHaveLength(1);
    wrapper.unmount();
  });
});
