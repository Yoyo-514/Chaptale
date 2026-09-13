import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import type { CloudRestorePlan } from '@chaptale/ipc-contract';

import { useEditorStore } from '@/features/editor';

import RestoreWizard from '../RestoreWizard.vue';
import { useCloudSyncStore } from '../store';

const stubs = {
  AppDialog: {
    props: ['open', 'title', 'description'],
    emits: ['update:open'],
    template: '<div v-if="open" class="dialog-stub"><slot /></div>'
  },
  AppDiffView: {
    props: ['original', 'modified', 'originalLabel', 'modifiedLabel'],
    template: '<div class="diff-stub" />'
  }
};

function plan(overrides: Partial<CloudRestorePlan> = {}): CloudRestorePlan {
  return {
    archiveId: 'archive.zip',
    identityMatches: true,
    entries: [
      { relativePath: '正文.md', verdict: 'conflict', archiveBytes: 100, localBytes: 120, system: false },
      { relativePath: '灵感/片段.md', verdict: 'add', archiveBytes: 30, localBytes: null, system: false },
      { relativePath: 'chaptale.json', verdict: 'identical', archiveBytes: 40, localBytes: 40, system: false }
    ],
    emptyDirectories: ['草稿'],
    localOnly: 2,
    ...overrides
  };
}

function mountWizard(options: { open?: boolean; plan?: CloudRestorePlan } = {}) {
  const cloud = useCloudSyncStore();

  if (options.open !== false) {
    cloud.wizard = {
      archiveId: 'archive.zip',
      archiveName: '拾光之城 pc 20260913-210405.zip',
      plan: options.plan ?? plan(),
      mode: 'new',
      choices: {},
      diff: null,
      receipt: null
    };
  }

  return { cloud, wrapper: mount(RestoreWizard, { global: { stubs } }) };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('恢复向导', () => {
  it('先讲清这次会动什么，默认停在零风险的“新增”', () => {
    const { wrapper } = mountWizard();

    // 计划摘要：四块格子，数字与标签成对，只有“冲突”带风险色。
    const stats = wrapper.findAll('.restore-stat');

    expect(stats.map(stat => stat.text().replace(/\s+/g, ''))).toEqual(['1新增', '1一致', '1冲突', '2本地独有']);
    expect(stats[2]?.classes()).toContain('is-risk');
    expect(stats[1]?.classes()).not.toContain('is-risk');
    // 空目录这类事实走提示条，不混进正文。
    expect(wrapper.find('.restore-note').text()).toContain('1 个空目录');

    const modes = wrapper.findAll('.restore-mode');

    expect(modes).toHaveLength(3);
    expect(modes.map(mode => mode.find('strong').text())).toEqual(['新增', '覆盖', '合并']);
    // 打开时选中的是“新增”，另外两个要作者主动点。
    expect(modes[0]?.classes()).toContain('is-active');
    expect(modes[0]?.attributes('aria-checked')).toBe('true');
    expect(wrapper.find('footer button:last-child').text()).toBe('解包到新目录');
  });
  it('合并逐项挑选：没决定时明说它不会被写入', async () => {
    const { cloud, wrapper } = mountWizard();

    await wrapper.findAll('.restore-mode')[2]?.trigger('click');

    expect(cloud.wizard?.mode).toBe('merge');

    const items = wrapper.findAll('.restore-conflict');

    expect(items).toHaveLength(1);
    expect(items[0]?.find('.restore-path').text()).toBe('正文.md');
    // 两侧大小按“归档 → 本地”给出：标签与数值各自成项，靠版式对齐，不靠拼成一句话。
    const delta = items[0]?.find('.restore-delta');

    expect(delta?.findAll('.restore-delta-label').map(label => label.text())).toEqual(['归档', '本地']);
    expect(delta?.findAll('.restore-delta-value').map(value => value.text())).toEqual(['100 B', '120 B']);
    expect(wrapper.find('.restore-note.is-pending').text()).toContain('还有 1 项没决定');

    const segments = items[0]?.findAll('.restore-segment-item');

    expect(segments?.map(segment => segment.text())).toEqual(['用归档', '用本地', '两个都留']);

    await segments?.[0]?.trigger('click');

    expect(cloud.wizard?.choices).toEqual({ '正文.md': 'archive' });
    expect(items[0]?.findAll('.restore-segment-item')[0]?.classes()).toContain('is-active');
    expect(wrapper.find('.restore-note.is-pending').exists()).toBe(false);
  });
  it('编辑器里有未保存内容时，覆盖与合并的确认入口不可达并说明原因', async () => {
    const { cloud, wrapper } = mountWizard();

    await wrapper.findAll('.restore-mode')[0]?.trigger('click');

    expect(wrapper.find('footer button:last-child').attributes('disabled')).toBeUndefined();

    useEditorStore().tabs = [{ id: '正文.md', path: '正文.md', dirty: true } as never];
    cloud.setRestoreMode('overwrite');
    await nextTick();

    expect(wrapper.find('footer button:last-child').attributes('disabled')).toBeDefined();
    expect(wrapper.find('.restore-note.is-blocked').text()).toContain('还没保存');
  });
  it('归档不能自证身份时，覆盖与合并的模式按钮被禁用', async () => {
    const { wrapper } = mountWizard({ plan: plan({ identityMatches: false }) });
    const modes = wrapper.findAll('.restore-mode');

    expect(modes[0]?.attributes('disabled')).toBeUndefined();
    expect(modes[1]?.attributes('disabled')).toBeDefined();
    expect(modes[2]?.attributes('disabled')).toBeDefined();
    expect(wrapper.find('.restore-note.is-blocked').text()).toContain('只能恢复到新目录');
  });
  it('回执只说事实：写到哪、写了几个、快照在哪、哪些没写', async () => {
    const { cloud, wrapper } = mountWizard();

    cloud.wizard = {
      ...cloud.wizard!,
      mode: 'overwrite',
      receipt: {
        ok: true,
        targetPath: '/home/novel',
        mode: 'overwrite',
        written: 7,
        writtenPaths: ['正文.md'],
        snapshotId: '20260913-210405',
        skipped: [{ relativePath: '草稿/01.md', reason: '你没对这项做决定，本地保持不动' }]
      }
    };
    await nextTick();

    // 回执按字段对齐地说事实：位置、写入数、快照、没写的。
    const facts = wrapper.findAll('.restore-facts > div');

    expect(facts.map(fact => fact.find('dt').text())).toEqual(['位置', '写入', '还原前快照', '未写入']);
    expect(facts.map(fact => fact.find('dd').text())).toEqual([
      '/home/novel',
      '7 个文件',
      '20260913-210405',
      '草稿/01.md'
    ]);
    // 回执状态下不再给“再来一次”的入口。
    expect(wrapper.find('footer button:last-child').text()).toBe('关闭');
  });
});
