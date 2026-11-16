import { flushPromises, mount } from '@vue/test-utils';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHostApplication } from '@chaptale/agent-host/application';
import type { HostCommand, HostCommands } from '@chaptale/agent-host/protocol';
import { CreationApplication } from '@chaptale/creation/application';
import type { ChaptaleDesktopApi } from '@chaptale/desktop/bridge';
import { openCreationStorage } from '@chaptale/storage';

import { useCreationStore } from '@/features/creation';

import SettingsSidebar from '../components/SettingsSidebar.vue';
import SkillSettings from '../sections/SkillSettings.vue';
import { useSettingsStore } from '../store';

describe('设置面板中的技能管理页', () => {
  let root: string | undefined;

  afterEach(async () => {
    delete (window as { chaptaleDesktop?: unknown }).chaptaleDesktop;
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it('分当前作品与全局展示技能，支持新建模板、导入、启停、定位文件、移入回收站及格式告警展示', async () => {
    root = await mkdtemp(join(tmpdir(), 'chaptale-skill-settings-'));
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

    // 预置一个全局同名技能与一个缺少 description 的损坏技能文件以触发格式告警
    await host.execute({
      method: 'createSkill',
      input: { scope: 'global', workId: null, name: 'polish', description: '全局通用润色' }
    });
    const brokenDir = join(root, 'agent', 'skills', 'broken-skill');
    await mkdir(brokenDir, { recursive: true });
    await writeFile(join(brokenDir, 'SKILL.md'), '---\nname: broken-skill\n---\n缺少描述正文\n', 'utf8');

    // 准备待导入的外部单个 .md 技能文件
    const externalMd = join(root, 'external-timeline.md');
    await writeFile(
      externalMd,
      '---\nname: timeline-check\ndescription: 校验章节纪年与节气\n---\n请核对时间线。\n',
      'utf8'
    );

    const selectSkillSource = vi.fn().mockResolvedValue(externalMd);
    const revealSkillPath = vi.fn().mockResolvedValue(undefined);
    const trashedFiles: string[] = [];

    const agentClient: ChaptaleDesktopApi['agentHost'] = {
      request: async <K extends keyof HostCommands>(method: K, input: HostCommands[K]['input']) => {
        const output = (await host.execute({
          method,
          input: structuredClone(input)
        } as HostCommand)) as HostCommands[K]['output'];
        if (method === 'removeSkill') {
          trashedFiles.push(...(output as HostCommands['removeSkill']['output']).files);
        }
        return output;
      },
      selectSkillSource,
      revealSkillPath,
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

    try {
      const pinia = createPinia();
      setActivePinia(pinia);
      const creationStore = useCreationStore();
      creationStore.works = [work];
      creationStore.state.activeWorkId = work.id;

      // 侧边栏包含「技能」分类并可切换
      const sidebar = mount(SettingsSidebar, { global: { plugins: [pinia] } });
      const skillNav = sidebar.findAll('button').find(btn => btn.text().includes('技能'));
      expect(skillNav).toBeDefined();
      await skillNav!.trigger('click');
      expect(useSettingsStore().activeSection).toBe('skills');
      sidebar.unmount();

      const wrapper = mount(SkillSettings, { attachTo: document.body, global: { plugins: [pinia] } });

      // 展示当前作品分组、全局分组及格式告警
      await vi.waitFor(() => {
        expect(wrapper.text()).toContain('当前作品《山海卷》');
        expect(wrapper.text()).toContain('全局技能');
        expect(wrapper.text()).toContain('全局通用润色');
      });
      expect(wrapper.get('[aria-label="技能格式告警"]').text()).toContain('broken-skill');

      // 在当前作品下新建同名 polish 技能 → 自动接管全局同名项
      const workSection = wrapper.get('section[aria-label="当前作品《山海卷》技能"]');
      await workSection
        .findAll('button')
        .find(btn => btn.text() === '新建技能')!
        .trigger('click');
      await workSection.get('input[aria-label="技能标识"]').setValue('polish');
      await workSection
        .get('textarea[aria-label="用途说明"]')
        .setValue('山海卷专属古奥文风润色。\n涉及先秦礼器与称谓时加载。');
      await workSection
        .findAll('button')
        .find(btn => btn.text() === '创建')!
        .trigger('click');

      const globalSection = wrapper.get('section[aria-label="全局技能"]');
      await vi.waitFor(() => {
        expect(workSection.text()).toContain('山海卷专属古奥文风润色。');
        expect(workSection.text()).toContain('涉及先秦礼器与称谓时加载。');
        expect(globalSection.text()).toContain('已被当前作品接管');
      });

      // 导入外部 .md 文件到全局技能
      await globalSection
        .findAll('button')
        .find(btn => btn.text() === '导入 .md 文件')!
        .trigger('click');
      await vi.waitFor(() => {
        expect(selectSkillSource).toHaveBeenCalledWith('file');
        expect(globalSection.text()).toContain('timeline-check');
        expect(globalSection.text()).toContain('校验章节纪年与节气');
      });

      // 停用作品级 polish
      await workSection.get('[aria-label="启用技能 polish"]').trigger('click');
      await vi.waitFor(() => {
        expect(workSection.get('[aria-label="启用技能 polish"]').attributes('data-state')).toBe('unchecked');
      });

      // 定位文件调用桥接
      await workSection
        .findAll('button')
        .find(btn => btn.text() === '定位文件')!
        .trigger('click');
      await vi.waitFor(() => {
        expect(revealSkillPath).toHaveBeenCalledTimes(1);
      });

      // 移除全局 timeline-check（经确认弹窗移入回收站）
      const timelineRow = globalSection.findAll('li').find(row => row.text().includes('timeline-check'))!;
      await timelineRow
        .findAll('button')
        .find(btn => btn.text() === '移除')!
        .trigger('click');
      await flushPromises();
      const confirmBtn = document.body.querySelector('[data-slot="app-alert-dialog-confirm"]') as HTMLButtonElement;
      expect(confirmBtn).not.toBeNull();
      confirmBtn.click();

      await vi.waitFor(() => {
        expect(trashedFiles).toHaveLength(1);
        expect(globalSection.text()).not.toContain('timeline-check');
      });

      wrapper.unmount();
    } finally {
      await host.dispose();
      creation.close();
    }
  });
});
