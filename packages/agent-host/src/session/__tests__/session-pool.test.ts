import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HostSessionPool, type CreateHostSessionPoolOptions, type HostSessionInput } from '../../index.ts';

let root: string;
let options: CreateHostSessionPoolOptions;
let input: HostSessionInput;
let pool: HostSessionPool;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chaptale-session-pool-'));
  for (const part of ['agent', 'sessions', '作品']) await mkdir(join(root, part));
  options = {
    agentDir: join(root, 'agent'),
    sessionDir: join(root, 'sessions'),
    modelRuntime: await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false
    })
  };
  input = { cwd: join(root, '作品'), systemPrompt: '只讨论作者提供的材料。' };
  pool = await HostSessionPool.create(options);
});

afterEach(async () => {
  await pool?.dispose();
  await rm(root, { recursive: true, force: true });
});

function saveUser(session: SessionManager, text = '已有会话') {
  session.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
  return session.getSessionFile()!;
}

describe('会话所有权', () => {
  it('多个 Agent 拥有独立原生会话，重连取得同一对象', async () => {
    const [first, second] = await Promise.all([pool.createSession(input), pool.createSession(input)]);
    expect(pool.get(first.session.sessionId)).toBe(first.session);
    expect(pool.get(second.session.sessionId)).toBe(second.session);
    saveUser(first.session.sessionManager, '第一位 Agent 的输入');
    expect(second.session.sessionManager.buildSessionContext().messages).toEqual([]);
    expect(pool.list()).toHaveLength(2);
    expect(pool.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.session.sessionId, cwd: input.cwd, status: 'idle' }),
        expect.objectContaining({ id: second.session.sessionId, cwd: input.cwd, status: 'idle' })
      ])
    );
  });

  it('空会话只在内存登记，不伪造消息强制落盘', async () => {
    const { session } = await pool.createSession(input);
    expect(pool.list()).toHaveLength(1);
    expect(session.messages.some(message => message.role === 'user')).toBe(false);
    expect(await readdir(options.sessionDir)).toEqual([]);
    await pool.close(session.sessionId);
    expect(pool.list()).toEqual([]);
    expect(await readdir(options.sessionDir)).toEqual([]);
  });

  it('关闭单个会话不释放其他 Agent，也不删除历史', async () => {
    const first = (await pool.createSession(input)).session;
    const second = (await pool.createSession(input)).session;
    const file = saveUser(first.sessionManager);
    const original = await readFile(file, 'utf8');
    await pool.close(first.sessionId);
    expect(pool.get(first.sessionId)).toBeUndefined();
    expect(pool.get(second.sessionId)).toBe(second);
    expect(await readFile(file, 'utf8')).toBe(original);
    expect(pool.list().map(item => item.id)).toEqual([second.sessionId]);
  });

  it('严格重开已关闭会话并继续原生历史', async () => {
    const first = (await pool.createSession(input)).session;
    const file = saveUser(first.sessionManager, '继续讨论的依据');
    await pool.close(first.sessionId);
    const restored = (await pool.openSession({ ...input, file })).session;
    expect(restored.sessionId).toBe(first.sessionId);
    expect(restored.messages).toMatchObject([{ role: 'user', content: '继续讨论的依据' }]);
    saveUser(restored.sessionManager, '另一条输入');
    expect(restored.sessionManager.buildSessionContext().messages).toMatchObject([
      { role: 'user', content: '继续讨论的依据' },
      { role: 'user', content: '另一条输入' }
    ]);
  });

  it('并发打开同一文件只准一个写者', async () => {
    const file = saveUser(SessionManager.create(input.cwd, options.sessionDir));
    const results = await Promise.allSettled([
      pool.openSession({ ...input, file }),
      pool.openSession({ ...input, file })
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(pool.list()).toHaveLength(1);
  });

  it('同进程的另一个池也不能接管尚未关闭的文件', async () => {
    const { session } = await pool.createSession(input);
    const file = saveUser(session.sessionManager);
    const another = await HostSessionPool.create(options);
    try {
      await expect(another.openSession({ ...input, file })).rejects.toThrow('已由本进程会话池持有');
      await pool.close(session.sessionId);
      const restored = await another.openSession({ ...input, file });
      expect(restored.session.sessionId).toBe(session.sessionId);
    } finally {
      await another.dispose();
    }
  });

  it('不同文件中的同一会话 ID 不能并发写入', async () => {
    const file = saveUser(SessionManager.create(input.cwd, options.sessionDir));
    const duplicate = join(options.sessionDir, 'duplicate.jsonl');
    await copyFile(file, duplicate);
    await pool.openSession({ ...input, file });
    await expect(pool.openSession({ ...input, file: duplicate })).rejects.toThrow('会话 ID');
    expect(pool.list()).toHaveLength(1);
  });

  it('恢复失败释放占位，不污染已有会话', async () => {
    const good = (await pool.createSession(input)).session;
    const file = saveUser(SessionManager.create(input.cwd, options.sessionDir));
    const original = await readFile(file, 'utf8');
    await writeFile(file, original + '{invalid}\n');
    await expect(pool.openSession({ ...input, file })).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe(original + '{invalid}\n');
    await writeFile(file, original);
    const recovered = await pool.openSession({ ...input, file });
    expect(pool.get(recovered.session.sessionId)).toBe(recovered.session);
    expect(pool.get(good.sessionId)).toBe(good);
  });

  it('模型装配失败后同一历史可重新打开', async () => {
    const file = saveUser(SessionManager.create(input.cwd, options.sessionDir));
    await expect(pool.openSession({ ...input, file, model: { provider: 'missing', id: 'missing' } })).rejects.toThrow(
      '未在应用模型运行时'
    );
    expect(pool.list()).toEqual([]);
    await expect(pool.openSession({ ...input, file })).resolves.toHaveProperty('session');
  });

  it('拒绝会话池目录以外的历史，保留原件', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    const file = saveUser(SessionManager.create(input.cwd, outside));
    const original = await readFile(file, 'utf8');
    await expect(pool.openSession({ ...input, file })).rejects.toThrow('必须位于会话池目录');
    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('拒绝不存在、相对路径和错误工作目录的恢复', async () => {
    await expect(pool.openSession({ ...input, file: 'missing.jsonl' })).rejects.toThrow('绝对路径');
    await expect(pool.openSession({ ...input, file: join(options.sessionDir, 'missing.jsonl') })).rejects.toMatchObject(
      { code: 'ENOENT' }
    );
    const file = saveUser(SessionManager.create(input.cwd, options.sessionDir));
    await expect(pool.openSession({ ...input, cwd: root, file })).rejects.toThrow('工作目录');
  });

  it('关闭幂等，关闭中的会话不能被重新取得', async () => {
    const { session } = await pool.createSession(input);
    const first = pool.close(session.sessionId);
    expect(pool.get(session.sessionId)).toBeUndefined();
    expect(pool.list()[0].status).toBe('closing');
    await Promise.all([first, pool.close(session.sessionId)]);
    await pool.close('unknown');
    expect(pool.list()).toEqual([]);
  });

  it('宿主关闭等待正在装配的会话并拒绝新的会话', async () => {
    const creation = pool.createSession(input);
    const disposal = pool.dispose();
    const { session } = await creation;
    await disposal;
    expect(pool.get(session.sessionId)).toBeUndefined();
    expect(pool.list()).toEqual([]);
    await expect(pool.createSession(input)).rejects.toThrow('已经关闭');
    await expect(pool.openSession({ ...input, file: join(options.sessionDir, 'missing.jsonl') })).rejects.toThrow(
      '已经关闭'
    );
    await pool.dispose();
  });

  it('宿主关闭不会被一个失败的装配阻止', async () => {
    const good = pool.createSession(input);
    const failed = pool.createSession({ ...input, systemPrompt: '' });
    const expectedFailure = expect(failed).rejects.toThrow('非空系统提示词');
    await pool.dispose();
    await good;
    await expectedFailure;
    expect(pool.list()).toEqual([]);
  });

  for (const field of ['agentDir', 'sessionDir'] as const) {
    it('拒绝无效池目录 ' + field, async () => {
      await expect(HostSessionPool.create({ ...options, [field]: '.' })).rejects.toThrow('绝对目录');
      await expect(HostSessionPool.create({ ...options, [field]: join(root, 'missing') })).rejects.toMatchObject({
        code: 'ENOENT'
      });
      const file = join(root, 'file');
      await writeFile(file, 'not a directory');
      await expect(HostSessionPool.create({ ...options, [field]: file })).rejects.toThrow('绝对目录');
    });
  }
});
