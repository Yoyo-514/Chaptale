import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { type AgentSession, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHostSession, type CreateHostSessionOptions } from '../../index.ts';

const systemPrompt = '你是创作助手，只根据作者提供的资料讨论作品。';
let root: string;
let options: CreateHostSessionOptions;
let sessions: AgentSession[];

beforeEach(async () => {
  sessions = [];
  root = await mkdtemp(join(tmpdir(), 'chaptale-agent-host-'));
  const cwd = join(root, '作品 空间');
  const agentDir = join(root, 'agent');
  await mkdir(cwd);
  await mkdir(agentDir);
  options = {
    cwd,
    agentDir,
    systemPrompt,
    modelRuntime: await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false
    }),
    sessionManager: SessionManager.inMemory(cwd)
  };
});

afterEach(async () => {
  for (const session of sessions) session.dispose();
  await rm(root, { recursive: true, force: true });
});

async function open(overrides: Partial<CreateHostSessionOptions> = {}) {
  const result = await createHostSession({ ...options, ...overrides });
  sessions.push(result.session);
  return result;
}

describe('SDK 会话边界', () => {
  it('采用显式提示词，不启用工具或保温', async () => {
    const { session } = await open();

    expect(session.systemPrompt).toContain(systemPrompt);
    expect(session.getActiveToolNames()).toEqual([]);
    expect(session.settingsManager.getCacheWarmingMode()).toBe('off');
    expect(session.messages).toEqual([]);
    expect(await readdir(options.agentDir)).toEqual([]);
  });

  it('显式重载后才应用新的提示词，不改变已有消息', async () => {
    let prompt = '第一份提示词';
    const { session } = await open({ systemPrompt: () => prompt });
    prompt = '下一轮提示词';
    expect(session.systemPrompt).toContain('第一份提示词');
    await session.reload();
    expect(session.systemPrompt).toContain('下一轮提示词');
    expect(session.messages).toEqual([]);
  });

  it('提示词即使与文件路径相同也按文本使用', async () => {
    const filename = join(root, 'prompt.md');
    await writeFile(filename, '不得作为提示词读取的文件内容');
    const { session } = await open({ systemPrompt: filename });

    expect(session.systemPrompt).toContain(filename);
    expect(session.systemPrompt).not.toContain('不得作为提示词读取');
  });

  it('不同会话不共享历史与设置', async () => {
    const first = (await open()).session;
    const second = (await open({ sessionManager: SessionManager.inMemory(options.cwd) })).session;

    first.sessionManager.appendMessage({ role: 'user', content: '第一部作品的讨论', timestamp: Date.now() });
    first.settingsManager.setDefaultThinkingLevel('low');

    expect(first.sessionId).not.toBe(second.sessionId);
    expect(second.sessionManager.buildSessionContext().messages).toEqual([]);
    expect(second.settingsManager.getDefaultThinkingLevel()).not.toBe('low');
  });

  it('忽略目录中的配置、扩展、Skills 和提示词', async () => {
    for (const directory of [options.agentDir, join(options.cwd, '.pi')]) {
      await mkdir(join(directory, 'extensions'), { recursive: true });
      await mkdir(join(directory, 'skills', 'unexpected'), { recursive: true });
      await mkdir(join(directory, 'prompts'), { recursive: true });
      await writeFile(join(directory, 'extensions', 'unexpected.ts'), 'throw new Error("不得自动执行扩展");');
      await writeFile(
        join(directory, 'skills', 'unexpected', 'SKILL.md'),
        '---\nname: unexpected\ndescription: 不得自动加载\n---\n'
      );
      await writeFile(join(directory, 'prompts', 'unexpected.md'), '不得自动加载的提示词');
      await writeFile(
        join(directory, 'settings.json'),
        JSON.stringify({ cacheWarming: 'idle', defaultTools: ['bash'] })
      );
      await writeFile(join(directory, 'auth.json'), 'invalid json');
      await writeFile(join(directory, 'models.json'), 'invalid json');
      await writeFile(join(directory, 'SYSTEM.md'), '不得自动加载的系统提示词');
      await writeFile(join(directory, 'APPEND_SYSTEM.md'), '不得自动追加的系统提示词');
      await writeFile(join(directory, 'AGENTS.md'), '不得自动加载的上下文');
    }
    await writeFile(join(options.cwd, 'AGENTS.md'), '不得自动加载的上下文');
    const { session } = await open();

    expect(session.resourceLoader.getSkills().skills).toEqual([]);
    expect(session.resourceLoader.getPrompts().prompts).toEqual([]);
    expect(session.systemPrompt).not.toContain('不得自动');
    expect(session.getActiveToolNames()).toEqual([]);
    expect(session.settingsManager.getCacheWarmingMode()).toBe('off');
    expect(await readFile(join(options.agentDir, 'auth.json'), 'utf8')).toBe('invalid json');
  });

  for (const field of ['cwd', 'agentDir'] as const) {
    it(`拒绝相对 ${field}`, async () => {
      await expect(open({ [field]: '.' })).rejects.toThrow('必须是已存在的绝对目录');
    });

    it(`拒绝不存在的 ${field}`, async () => {
      await expect(open({ [field]: join(root, 'missing') })).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it(`拒绝将文件用作 ${field}`, async () => {
      const filename = join(root, 'file');
      await writeFile(filename, '');
      await expect(open({ [field]: filename })).rejects.toThrow('必须是已存在的绝对目录');
    });
  }

  it('拒绝跨工作目录的会话', async () => {
    await expect(open({ sessionManager: SessionManager.inMemory(root) })).rejects.toThrow('工作目录不一致');
  });

  it.each(['', ' \n\t'])('拒绝空提示词 %j', async emptyPrompt => {
    await expect(open({ systemPrompt: emptyPrompt })).rejects.toThrow('必须显式提供非空系统提示词');
  });

  it('释放空会话后子进程自然退出', async () => {
    const entry = new URL('../../index.ts', import.meta.url).href;
    const code = `
      import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
      import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
      import { createHostSession } from ${JSON.stringify(entry)};
      const cwd = ${JSON.stringify(options.cwd)};
      const modelRuntime = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(), modelsPath: null,
        allowModelNetwork: false, refreshOnCreate: false
      });
      const { session } = await createHostSession({
        cwd, agentDir: ${JSON.stringify(options.agentDir)},
        systemPrompt: ${JSON.stringify(systemPrompt)}, modelRuntime,
        sessionManager: SessionManager.inMemory(cwd)
      });
      session.dispose();
      console.log('session disposed');
    `;
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', code], {
      cwd: join(import.meta.dirname, '../../..'),
      timeout: 15_000,
      windowsHide: true
    });
    expect(stdout.trim()).toBe('session disposed');
  }, 20_000);
});
