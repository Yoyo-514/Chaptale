import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelRuntimeProcessInput, ModelRuntimeProcessResult } from './fixtures/model-runtime-process.ts';

const modelsConfig = {
  providers: {
    'chaptale-test': {
      name: 'Chaptale 测试供应商',
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      models: [{ id: 'test-model', name: '测试模型' }]
    }
  }
};

const authConfig = { 'chaptale-test': { type: 'api_key', key: 'sk-test-not-a-real-key' } };
const testModel = { provider: 'chaptale-test', id: 'test-model' };

let root: string;
let input: ModelRuntimeProcessInput;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chaptale-model-runtime-'));
  input = {
    configDir: join(root, '配置 目录'),
    cwd: join(root, '作品 空间'),
    agentDir: join(root, 'agent')
  };
  for (const directory of [input.configDir, input.cwd, input.agentDir]) await mkdir(directory);
});

afterEach(async () => {
  // 只清理由本测试创建的临时目录，不删除调用方传入的路径。
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('chaptale-model-runtime-')) {
    throw new Error('拒绝清理测试临时目录以外的路径');
  }
  await rm(root, { recursive: true, force: true });
});

async function writeModelsConfig(value: string | object = modelsConfig): Promise<void> {
  await writeFile(join(input.configDir, 'models.json'), typeof value === 'string' ? value : JSON.stringify(value));
}

async function writeAuthConfig(value: string | object = authConfig): Promise<void> {
  await writeFile(join(input.configDir, 'auth.json'), typeof value === 'string' ? value : JSON.stringify(value));
}

async function run(overrides: Partial<ModelRuntimeProcessInput> = {}): Promise<ModelRuntimeProcessResult> {
  const options = { ...input, ...overrides };
  const fixture = fileURLToPath(new URL('./fixtures/model-runtime-process.ts', import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, [fixture, JSON.stringify(options)], {
    cwd: root,
    timeout: 30_000,
    // 输出包含 SDK 内置模型目录，保留超出默认的缓冲以覆盖目录随版本增长。
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true
  });
  return JSON.parse(stdout.trim().split('\n').pop()!) as ModelRuntimeProcessResult;
}

describe('应用模型运行时装配', () => {
  it('模型目录与凭据都来自显式配置，自定义模型可供会话选择', async () => {
    await writeModelsConfig();
    await writeAuthConfig();

    const result = await run();

    expect(result.ok).toBe(true);
    expect(result.models).toContainEqual(testModel);
    // 可用列表只包含测试凭据对应的模型；若装配读取开发机全局目录，这里会包含其他凭据模型。
    expect(result.available).toEqual([testModel]);
    expect(result.selected).toEqual(testModel);
    // SDK 只在显式配置目录内初始化凭据存储与目录缓存，且不改写已有凭据。
    // 包的目标为 ES2022；排序仅修改 readdir 刚创建的数组。
    // oxlint-disable-next-line unicorn/no-array-sort
    expect((await readdir(input.configDir)).sort()).toEqual(['auth.json', 'models-store.json', 'models.json']);
    expect(JSON.parse(await readFile(join(input.configDir, 'auth.json'), 'utf8'))).toEqual(authConfig);
    // 作品与资源目录保持干净。
    expect(await readdir(input.cwd)).toEqual([]);
    expect(await readdir(input.agentDir)).toEqual([]);
  });

  it('配置目录为空时返回待配置运行时，不包含可用模型', async () => {
    const result = await run();

    expect(result.ok).toBe(true);
    expect(result.available).toEqual([]);
    expect(result.selected).not.toEqual(testModel);
    // 凭据文件缺失被接受，并由 SDK 在配置目录内初始化自有存储。
    // oxlint-disable-next-line unicorn/no-array-sort
    expect((await readdir(input.configDir)).sort()).toEqual(['auth.json', 'models-store.json']);
  });

  it('有模型目录而无凭据时，模型只被识别、不标记可用', async () => {
    await writeModelsConfig();

    const result = await run();

    expect(result.ok).toBe(true);
    expect(result.models).toContainEqual(testModel);
    expect(result.available).toEqual([]);
    expect(result.selected).not.toEqual(testModel);
  });

  it('auth.json 不是有效 JSON 时拒绝装配且不回显内容', async () => {
    const secret = 'sk-secret-marker-9931';
    await writeModelsConfig();
    await writeAuthConfig(`{ "chaptale-test": { "type": "api_key", "key": "${secret}"`);

    const result = await run();

    expect(result.ok).toBe(false);
    expect(result.error).toBe('应用 auth.json 不是有效的 JSON');
    expect(result.error).not.toContain(secret);
  });

  it('auth.json 凭据格式无效时拒绝装配', async () => {
    await writeModelsConfig();
    await writeAuthConfig({ 'chaptale-test': { type: 'api_key', key: 12345 } });

    const result = await run();

    expect(result.ok).toBe(false);
    expect(result.error).toBe('应用 auth.json 凭据格式无效');
  });

  it('auth.json 带 BOM 的合法配置正常装配', async () => {
    await writeModelsConfig();
    await writeAuthConfig(`\uFEFF${JSON.stringify(authConfig)}`);

    const result = await run();

    expect(result.ok).toBe(true);
    expect(result.available).toEqual([testModel]);
  });

  it('models.json 无法解析时拒绝装配', async () => {
    await writeAuthConfig();
    await writeModelsConfig('{ "providers": {');

    const result = await run();

    expect(result.ok).toBe(false);
    expect(result.error).toBe('应用 models.json 加载或模型配置组合失败');
  });

  it('models.json 结构无效时拒绝装配', async () => {
    await writeAuthConfig();
    await writeModelsConfig({ providers: { 'chaptale-test': { models: [{ name: '缺少 id 的模型' }] } } });

    const result = await run();

    expect(result.ok).toBe(false);
    expect(result.error).toBe('应用 models.json 加载或模型配置组合失败');
  });

  it.each(['relative/config', join(tmpdir(), 'chaptale-missing-config-dir')])(
    'configDir 为无效路径 %s 时拒绝装配',
    async configDir => {
      const result = await run({ configDir });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('configDir 必须是已存在的绝对目录');
    }
  );

  it('configDir 指向文件而非目录时拒绝装配', async () => {
    const file = join(root, '不是目录.json');
    await writeFile(file, '{}');

    const result = await run({ configDir: file });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('configDir 必须是已存在的绝对目录');
  });

  it('models-store.json 损坏时拒绝装配，不静默降级', async () => {
    await writeModelsConfig();
    await writeAuthConfig();
    await writeFile(join(input.configDir, 'models-store.json'), '{ 损坏的缓存 [');

    const result = await run();

    expect(result.ok).toBe(false);
    expect(result.error).toBe('应用模型目录缓存或凭据可用性检查失败');
  });
});
