import { flushPromises, mount } from '@vue/test-utils';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createHostApplication, type HostApplication } from '@chaptale/agent-host/application';
import type { HostCommand, HostCommands } from '@chaptale/agent-host/protocol';
import { CreationApplication } from '@chaptale/creation/application';
import type { ChaptaleDesktopApi } from '@chaptale/desktop/bridge';
import { openCreationStorage } from '@chaptale/storage';

import { useCreationStore } from '@/features/creation';
import { useNotificationStore } from '@/features/notifications';
import { SettingsSidebar, useSettingsStore } from '@/features/settings';

import VectorIndexEntry from '../components/VectorIndexEntry.vue';
import RetrievalSettings from '../settings/RetrievalSettings.vue';
import { useAgentStore } from '../store';

let root: string;
let host: HostApplication;
let creation: CreationApplication;
let workId: string;
let baseUrl: string;
let received: { model: string; input: string[]; dimensions?: number }[];
let closeServer: () => Promise<unknown>;
/** 设置后服务以 HTTP 401 拒绝请求。 */
let rejection: string | undefined;
let wrapper: ReturnType<typeof mount> | undefined;

beforeEach(async () => {
  received = [];
  rejection = undefined;
  // 本机的 OpenAI 兼容 /embeddings 服务，每段文字返回一个固定向量。
  const server = createServer((request, response) => {
    // 测试环境里宿主用的是 happy-dom 的 fetch，跨源请求会先发预检。
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', '*');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    let text = '';
    request.on('data', chunk => (text += chunk));
    request.on('end', () => {
      const body = JSON.parse(text) as (typeof received)[number];
      received.push(body);
      response.setHeader('Content-Type', 'application/json');
      if (rejection) {
        response.writeHead(401).end(JSON.stringify({ error: { message: rejection } }));
        return;
      }
      const embedding = Array.from({ length: body.dimensions ?? 8 }, () => 0.5);
      response.end(JSON.stringify({ data: body.input.map((_, index) => ({ index, embedding })) }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  closeServer = () => new Promise(resolve => server.close(resolve));

  root = await mkdtemp(join(tmpdir(), 'chaptale-retrieval-ui-'));
  creation = new CreationApplication(await openCreationStorage({ rootDir: join(root, 'creation') }));
  host = await createHostApplication({
    cwd: join(root, 'work'),
    agentDir: join(root, 'agent'),
    configDir: join(root, 'config'),
    sessionDir: join(root, 'sessions'),
    settingsFile: join(root, 'config', 'settings.json'),
    creation
  });
  const work = creation.executeAuthor({
    method: 'createWork',
    input: { commandId: randomUUID(), title: '长夜行', kind: 'novel' }
  });
  if (!work.ok) throw new Error(work.error.message);
  workId = work.value.id;
  creation.executeAuthor({
    method: 'createEntry',
    input: {
      commandId: randomUUID(),
      workId,
      parentId: null,
      section: 'manuscript',
      kind: 'document',
      title: '序章',
      format: 'txt',
      content: '将军守城。'
    }
  });
  const agentHost: ChaptaleDesktopApi['agentHost'] = {
    request: async <K extends keyof HostCommands>(method: K, input: HostCommands[K]['input']) =>
      (await host.execute({ method, input: structuredClone(input) } as HostCommand)) as HostCommands[K]['output'],
    subscribe: listener => host.subscribe(listener),
    onDisconnected: () => () => {}
  };
  Object.defineProperty(window, 'chaptaleDesktop', {
    configurable: true,
    value: {
      agentHost,
      creation: {
        request: (method: string, input: unknown) => creation.execute({ method, input } as never),
        subscribe: (listener: (event: unknown) => void) => creation.subscribe(listener as never),
        onDisconnected: () => () => {}
      }
    }
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  useCreationStore().works = [work.value];
  await useAgentStore().connect();
});

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  delete (window as { chaptaleDesktop?: unknown }).chaptaleDesktop;
  await host.dispose();
  creation.close();
  await closeServer();
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const button = (scope: { querySelectorAll: ParentNode['querySelectorAll'] }, label: string) =>
  [...scope.querySelectorAll('button')].find(item => item.textContent?.trim() === label)!;

it('设置页填写检索服务后可以测试连接和保存，密钥保存后不回显', async () => {
  const sidebar = mount(SettingsSidebar);
  await sidebar
    .findAll('button')
    .find(item => item.text().includes('检索'))!
    .trigger('click');
  expect(useSettingsStore().activeSection).toBe('retrieval');
  sidebar.unmount();

  const page = mount(RetrievalSettings, { attachTo: document.body });
  wrapper = page;
  const key = () => page.get('input[type="password"]').element as HTMLInputElement;
  // 读取已保存的设置后表单才可用。
  await vi.waitFor(() => expect(button(page.element, '测试连接').disabled).toBe(false));
  expect(key().placeholder).toBe('服务不需要密钥时留空');
  await page.get('input[type="url"]').setValue(baseUrl);
  await page.get('input[type="password"]').setValue('sk-local');
  await page.get('input[placeholder^="例如"]').setValue('Qwen/Qwen3-Embedding-8B');

  button(page.element, '测试连接').click();
  await vi.waitFor(() => expect(page.get('[role="status"]').text()).toBe('连接成功，服务返回 8 维向量。'));
  expect(received).toEqual([{ model: 'Qwen/Qwen3-Embedding-8B', input: ['测试连接'], encoding_format: 'float' }]);
  expect(await host.execute({ method: 'embeddingSettings', input: undefined })).toBeNull();

  await page.get('form').trigger('submit');
  await vi.waitFor(() => expect(page.get('[role="status"]').text()).toBe('已保存。'));
  expect(key().value).toBe('');
  expect(key().placeholder).toBe('已保存，留空保持不变');
  expect(await host.execute({ method: 'embeddingSettings', input: undefined })).toEqual({
    baseUrl,
    model: 'Qwen/Qwen3-Embedding-8B',
    dimensions: null,
    hasApiKey: true
  });

  await page.get('input[placeholder^="例如"]').setValue('BAAI/bge-m3');
  await page.get('form').trigger('submit');
  await vi.waitFor(() =>
    expect(page.get('[role="status"]').text()).toBe('已保存。模型或维度变了，已建立的索引要重建后才能使用。')
  );

  await page.get('input[type="url"]').setValue('ftp://example.com');
  await page.get('form').trigger('submit');
  await vi.waitFor(() => expect(page.get('[role="alert"]').text()).toBe('服务地址必须为有效的 HTTP 或 HTTPS 地址'));
});

it('索引弹层先提示设置服务；建立前列出要发送的内容，确认后建立并通知完成', async () => {
  wrapper = mount(VectorIndexEntry, { props: { workId }, attachTo: document.body });
  const trigger = wrapper.get('button[aria-label="语义检索索引"]');
  const popover = () => document.querySelector<HTMLElement>('.vector-index-popover')!;
  const reopen = async () => {
    if (popover()) await trigger.trigger('click');
    await trigger.trigger('click');
    await flushPromises();
  };

  await reopen();
  await vi.waitFor(() => expect(popover().textContent).toContain('还没有设置检索服务'));
  expect(button(popover(), '建立索引')).toBeUndefined();
  button(popover(), '检索设置').click();
  await flushPromises();
  expect(useSettingsStore()).toMatchObject({ isOpen: true, activeSection: 'retrieval' });
  expect(popover()).toBeNull();

  await host.execute({
    method: 'saveEmbeddingSettings',
    input: { baseUrl, model: 'Qwen/Qwen3-Embedding-8B', dimensions: null }
  });
  await reopen();
  await vi.waitFor(() => expect(popover().textContent).toContain('这部作品还没有建立索引'));
  button(popover(), '建立索引').click();
  await flushPromises();
  expect(popover().textContent).toContain(
    `将把 1 段、约 8 字发送到 ${new URL(baseUrl).host}（Qwen/Qwen3-Embedding-8B） 计算向量。`
  );
  // 取消后不发送。
  button(popover(), '取消').click();
  await flushPromises();
  expect(received).toEqual([]);

  button(popover(), '建立索引').click();
  await flushPromises();
  button(popover(), '开始建立').click();
  await vi.waitFor(() => expect(popover().textContent).toContain('已索引全部 1 段。'));
  expect(received.map(request => request.input)).toEqual([['序章\n将军守城。']]);
  expect(useNotificationStore().items).toContainEqual(
    expect.objectContaining({ kind: 'success', title: '《长夜行》的索引已建好', description: '共 1 段' })
  );

  // 换了维度的索引要重建，重建发送全部段落。
  await host.execute({
    method: 'saveEmbeddingSettings',
    input: { baseUrl, model: 'Qwen/Qwen3-Embedding-8B', dimensions: 4 }
  });
  await reopen();
  await vi.waitFor(() => expect(popover().textContent).toContain('重建后才能使用'));
  button(popover(), '重建索引').click();
  await flushPromises();
  expect(popover().textContent).toContain('重建会清空已有索引，把全部 1 段、约 8 字发送到');
  button(popover(), '开始重建').click();
  await vi.waitFor(() => expect(popover().textContent).toContain('已索引全部 1 段。'));
  expect(received.at(-1)).toMatchObject({ dimensions: 4 });
});

it('建立失败时通知原因，弹层保留失败说明并可以接着建立', async () => {
  await host.execute({
    method: 'saveEmbeddingSettings',
    input: { baseUrl, model: 'Qwen/Qwen3-Embedding-8B', dimensions: null }
  });
  rejection = 'Invalid token';
  wrapper = mount(VectorIndexEntry, { props: { workId }, attachTo: document.body });
  await wrapper.get('button[aria-label="语义检索索引"]').trigger('click');
  const popover = () => document.querySelector<HTMLElement>('.vector-index-popover')!;
  await vi.waitFor(() => expect(button(popover(), '建立索引')).toBeDefined());
  button(popover(), '建立索引').click();
  await flushPromises();
  button(popover(), '开始建立').click();
  await vi.waitFor(() =>
    expect(popover().textContent).toContain('上次建立没有完成：检索服务返回 HTTP 401：Invalid token')
  );
  expect(useNotificationStore().items).toMatchObject([
    { kind: 'error', title: '《长夜行》的索引没有建完', description: '检索服务返回 HTTP 401：Invalid token' }
  ]);

  rejection = undefined;
  button(popover(), '继续建立').click();
  await flushPromises();
  button(popover(), '开始建立').click();
  await vi.waitFor(() => expect(popover().textContent).toContain('已索引全部 1 段。'));
  expect(popover().textContent).not.toContain('上次建立没有完成');
});
