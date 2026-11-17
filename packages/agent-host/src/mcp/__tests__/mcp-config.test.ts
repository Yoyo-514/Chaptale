import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  computeMcpServerFingerprint,
  globalMcpConfigFile,
  loadMergedMcpConfig,
  patchMcpServerInFile,
  saveValidatedMcpConfig,
  workMcpConfigFile
} from '../config.ts';

describe('MCP 两级配置与字面量校验', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'chaptale-mcp-cfg-'));
    dirs.push(dir);
    return dir;
  }

  it('保存时拦截 ! 命令注入与 ${VAR} 占位符，同时完整保留含普通 $ 的密钥字面量', async () => {
    const root = await makeTempDir();
    const file = globalMcpConfigFile(root);

    await expect(
      saveValidatedMcpConfig(
        file,
        'global',
        JSON.stringify({
          mcpServers: {
            badCmd: { url: 'https://example.com/mcp', headers: { Authorization: '!gh auth token' } }
          }
        })
      )
    ).rejects.toThrow(/命令/);

    await expect(
      saveValidatedMcpConfig(
        file,
        'global',
        JSON.stringify({
          mcpServers: {
            badEnv: { command: 'node', args: ['srv.js'], env: { API_KEY: '${TAVILY_API_KEY}' } }
          }
        })
      )
    ).rejects.toThrow(/环境变量/);

    await saveValidatedMcpConfig(
      file,
      'global',
      JSON.stringify(
        {
          mcpServers: {
            wiki: {
              url: 'https://wiki.example.com/mcp',
              headers: { Authorization: 'Bearer $2b$12$literalSecretToken!' }
            }
          }
        },
        null,
        2
      )
    );

    const loaded = await loadMergedMcpConfig({ agentDir: root, workId: null, workFilesDir: null });
    expect(loaded.globalErrors).toEqual([]);
    expect(loaded.servers).toHaveLength(1);
    const server = loaded.servers[0]!;
    expect('url' in server.config && server.config.headers?.Authorization).toBe('Bearer $2b$12$literalSecretToken!');
  });

  it('合并全局与作品级 mcp.json：支持作品专属服务、同名替换及对全局服务的轻量启停/暴露覆盖', async () => {
    const root = await makeTempDir();
    const agentDir = join(root, 'agent');
    const workFilesDir = join(root, 'works', 'w1', 'files');
    const globalFile = globalMcpConfigFile(agentDir);
    const workFile = workMcpConfigFile(workFilesDir);

    await saveValidatedMcpConfig(
      globalFile,
      'global',
      JSON.stringify({
        mcpServers: {
          exa: { url: 'https://exa.example.com/mcp', description: '全网检索' },
          notion: { url: 'https://notion.example.com/mcp', exposure: 'direct' },
          shared: { command: 'node', args: ['global.js'] }
        }
      })
    );

    await saveValidatedMcpConfig(
      workFile,
      'work',
      JSON.stringify(
        {
          mcpServers: {
            notion: { enabled: false },
            exa: { exposure: 'deferred' },
            shared: { command: 'node', args: ['work-specific.js'] },
            tang: { command: 'node', args: ['tang-db.js'], description: '唐代官制库' }
          }
        },
        null,
        4
      )
    );

    const merged = await loadMergedMcpConfig({ agentDir, workId: 'w1', workFilesDir });
    expect(merged.globalErrors).toEqual([]);
    expect(merged.workErrors).toEqual([]);

    const byName = new Map(merged.servers.map(item => [item.name, item]));
    // 轻量覆盖保留全局底层连接归属，但应用当前作品的 enabled / exposure
    expect(byName.get('notion')).toMatchObject({
      definedIn: 'global',
      definedWorkId: null,
      overriddenInWork: true,
      enabled: false,
      exposure: 'direct'
    });
    expect(byName.get('exa')).toMatchObject({
      definedIn: 'global',
      definedWorkId: null,
      overriddenInWork: true,
      enabled: true,
      exposure: 'deferred'
    });
    // 同名完整定义替换为作品级连接
    expect(byName.get('shared')).toMatchObject({
      definedIn: 'work',
      definedWorkId: 'w1',
      overriddenInWork: false
    });
    expect(byName.get('shared')!.config).toMatchObject({ args: ['work-specific.js'] });
    // 作品新增专属服务
    expect(byName.get('tang')).toMatchObject({
      definedIn: 'work',
      definedWorkId: 'w1',
      enabled: true,
      exposure: 'codemode'
    });

    // patchMcpServerInFile 保留文件原有 4 空格缩进，且指纹在只改 exposure 时稳定、改命令或 URL 时变化
    await patchMcpServerInFile(workFile, 'work', 'tang', { exposure: 'direct' });
    const afterPatch = await loadMergedMcpConfig({ agentDir, workId: 'w1', workFilesDir });
    expect(afterPatch.workJson).toContain('    "mcpServers"');
    const tangBefore = byName.get('tang')!;
    const tangAfter = afterPatch.servers.find(item => item.name === 'tang')!;
    expect(tangAfter.exposure).toBe('direct');
    expect(tangAfter.fingerprint).toBe(tangBefore.fingerprint);

    const changedCmdFp = computeMcpServerFingerprint('work', 'w1', 'tang', {
      command: 'node',
      args: ['other-script.js']
    });
    expect(changedCmdFp).not.toBe(tangBefore.fingerprint);

    // 磁盘文件被外部手工改坏时，loadMergedMcpConfig 不抛异常崩掉宿主，而是收集到 errors 供界面提示
    await writeFile(workFile, '{ broken json', 'utf8');
    const broken = await loadMergedMcpConfig({ agentDir, workId: 'w1', workFilesDir });
    expect(broken.workErrors.length).toBeGreaterThan(0);
    expect(broken.servers.map(item => item.name)).toEqual(['exa', 'notion', 'shared']);
  });
});
