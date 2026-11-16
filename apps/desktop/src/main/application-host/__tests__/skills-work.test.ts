import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHostApplication, type HostApplication } from '@chaptale/agent-host/application';
import type { ManagedSkillsSnapshot, SessionSkillItem } from '@chaptale/agent-host/protocol';
import { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult } from '@chaptale/creation/contracts';
import { openCreationStorage } from '@chaptale/storage';

import { APPLICATION_HOST_CHANNELS } from '../../../bridge/channels';
import { resolveAuthorizedSkillRevealPath } from '../skill-paths';

function unwrap<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('work-scoped skills & desktop skill path guard', () => {
  let root: string;
  let creation: CreationApplication;
  let host: HostApplication;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'chaptale-work-skills-'));
    creation = new CreationApplication(await openCreationStorage({ rootDir: join(root, 'creation') }));
    host = await createHostApplication({
      cwd: join(root, 'work'),
      agentDir: join(root, 'agent'),
      configDir: join(root, 'config'),
      sessionDir: join(root, 'sessions'),
      settingsFile: join(root, 'config', 'settings.json'),
      creation
    });
    await host.execute({
      method: 'saveProvider',
      input: {
        id: 'offline-provider',
        apiKey: 'offline-key',
        config: {
          baseUrl: 'http://127.0.0.1:9',
          api: 'openai-completions',
          models: [{ id: 'offline-model', name: '离线模型', contextWindow: 8192, maxTokens: 512 }]
        }
      }
    });
  });

  afterEach(async () => {
    await host.dispose();
    creation.close();
    await rm(root, { recursive: true, force: true });
  });

  it('作品级 Skills 与其他作品及独立会话严格隔离，同名接管全局并随作品回收站恢复保留', async () => {
    const workA = unwrap(
      creation.executeAuthor({ method: 'createWork', input: { commandId: randomUUID(), title: '甲书', kind: 'novel' } })
    );
    const workB = unwrap(
      creation.executeAuthor({
        method: 'createWork',
        input: { commandId: randomUUID(), title: '乙剧', kind: 'script' }
      })
    );

    await host.execute({
      method: 'createSkill',
      input: { scope: 'global', workId: null, name: 'polish', description: '全局润色' }
    });
    await host.execute({
      method: 'createSkill',
      input: { scope: 'work', workId: workA.id, name: 'polish', description: '甲书古言润色' }
    });
    const tangSkill = (await host.execute({
      method: 'createSkill',
      input: { scope: 'work', workId: workA.id, name: 'tang-ranks', description: '唐代官阶表' }
    })) as { skill: { filePath: string }; snapshot: ManagedSkillsSnapshot };

    const sessionA = (await host.execute({
      method: 'create',
      input: { model: { provider: 'offline-provider', id: 'offline-model' }, workId: workA.id }
    })) as string;
    const sessionB = (await host.execute({
      method: 'create',
      input: { model: { provider: 'offline-provider', id: 'offline-model' }, workId: workB.id }
    })) as string;
    const sessionFree = (await host.execute({
      method: 'create',
      input: { model: { provider: 'offline-provider', id: 'offline-model' }, workId: null }
    })) as string;

    const itemsA = (await host.execute({ method: 'sessionSkills', input: { id: sessionA } })) as SessionSkillItem[];
    const itemsB = (await host.execute({ method: 'sessionSkills', input: { id: sessionB } })) as SessionSkillItem[];
    const itemsFree = (await host.execute({
      method: 'sessionSkills',
      input: { id: sessionFree }
    })) as SessionSkillItem[];

    expect(itemsA).toEqual([
      { name: 'polish', description: '甲书古言润色', scope: 'work', disableModelInvocation: false },
      { name: 'tang-ranks', description: '唐代官阶表', scope: 'work', disableModelInvocation: false }
    ]);
    expect(itemsB).toEqual([
      { name: 'polish', description: '全局润色', scope: 'global', disableModelInvocation: false }
    ]);
    expect(itemsFree).toEqual([
      { name: 'polish', description: '全局润色', scope: 'global', disableModelInvocation: false }
    ]);

    // 停用作品 A 的 polish：不回退全局，且移入回收站再恢复后配置与技能文件仍在
    await host.execute({
      method: 'setSkillEnabled',
      input: { scope: 'work', workId: workA.id, name: 'polish', enabled: false }
    });
    await host.execute({ method: 'trashWork', input: { commandId: randomUUID(), workId: workA.id } });
    unwrap(creation.executeAuthor({ method: 'restoreWork', input: { commandId: randomUUID(), workId: workA.id } }));

    const afterRestore = (await host.execute({
      method: 'listSkills',
      input: { workId: workA.id }
    })) as ManagedSkillsSnapshot;
    const workPolish = afterRestore.skills.find(s => s.scope === 'work' && s.name === 'polish');
    expect(workPolish?.enabled).toBe(false);

    // 平台桥接校验：只放行当前管理快照登记的技能文件与根目录，拒绝任意外部路径
    expect(APPLICATION_HOST_CHANNELS.agent.selectSkillSource).toBe('agent-host:select-skill-source');
    expect(APPLICATION_HOST_CHANNELS.agent.revealSkillPath).toBe('agent-host:reveal-skill-path');
    expect(resolveAuthorizedSkillRevealPath(afterRestore, tangSkill.skill.filePath)).toEqual({
      kind: 'item',
      path: tangSkill.skill.filePath
    });
    expect(resolveAuthorizedSkillRevealPath(afterRestore, afterRestore.globalDir)).toEqual({
      kind: 'directory',
      path: afterRestore.globalDir
    });
    expect(() => resolveAuthorizedSkillRevealPath(afterRestore, join(root, 'outside.txt'))).toThrow(/未在技能列表/);
  });
});
