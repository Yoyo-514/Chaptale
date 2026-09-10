import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';
import type { ContentEntry } from '@chaptale/shared';

import { useContentStore } from '@/features/content';
import { useSessionStore } from '@/features/sessions';
import { useSettingsStore } from '@/features/settings';

import { buildPersonaOptions, useChatPersona } from '../../composables/useChatPersona';

beforeEach(() => {
  setActivePinia(createPinia());
});

function createSession(overrides: Partial<ChaptaleSessionListItem> = {}): ChaptaleSessionListItem {
  return {
    id: 'session-1',
    name: '理清这个故事',
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    cwd: 'E:/backend-study/Chaptale',
    path: 'session.jsonl',
    leafId: null,
    messageCount: 0,
    scope: 'global',
    totalTokens: 0,
    ...overrides
  };
}

function createPersonaEntry(id: string, name: string): ContentEntry {
  return {
    kind: 'persona',
    id,
    name,
    source: 'builtin',
    sourcePath: `builtin://personas/${id}.md`,
    hash: `hash-${id}`,
    effective: true,
    persona: { id, name, type: 'chat', execution: 'chat' }
  };
}

/** 专员清单来自内容目录，所以测试必须让 content.list 真的返回一份清单。 */
function installDesktopMock(entries: ContentEntry[]) {
  const state = {
    settings: { version: 1, storage: { mode: 'global' as const }, theme: 'light' as const },
    webTools: {
      search: { enabled: false, provider: 'duckduckgo' as const },
      keys: {},
      fetch: { timeoutSeconds: 30, maxBytes: 2 * 1024 * 1024 },
      ssrf: { allowRanges: [] }
    },
    paths: {
      rootDir: 'C:/Users/Test/.chaptale',
      agentDir: 'C:/Users/Test/.chaptale/agent',
      settingsPath: 'C:/Users/Test/.chaptale/settings.json',
      modelsPath: 'C:/Users/Test/.chaptale/agent/models.json',
      webToolsConfigPath: 'C:/Users/Test/.chaptale/agent/web-tools.json',
      sessionsRootDir: 'C:/Users/Test/.chaptale/agent/sessions',
      effectiveSessionDir: 'C:/Users/Test/.chaptale/agent/sessions/global'
    }
  };
  const api = {
    content: { list: vi.fn().mockResolvedValue({ entries, diagnostics: [] }) },
    session: {
      create: vi
        .fn()
        .mockImplementation(async (options: { name?: string; personaId?: string }) =>
          createSession({ id: 'session-2', name: options.name, personaId: options.personaId })
        ),
      list: vi.fn().mockResolvedValue([createSession()])
    },
    settings: {
      getState: vi.fn().mockResolvedValue(state),
      update: vi.fn().mockResolvedValue(state)
    },
    models: { list: vi.fn().mockResolvedValue({ providers: [], models: [], defaultModel: undefined }) }
  } as unknown as NonNullable<typeof window.chaptaleDesktop>;

  window.chaptaleDesktop = api;
  return api;
}

async function mountPersona(session?: Partial<ChaptaleSessionListItem>) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', name: 'chat', component: defineComponent({ template: '<div />' }) }]
  });
  await router.push('/');
  await router.isReady();

  let persona!: ReturnType<typeof useChatPersona>;
  mount(
    defineComponent({
      setup() {
        persona = useChatPersona();
        return () => null;
      }
    }),
    { global: { plugins: [router] } }
  );

  const sessionStore = useSessionStore();
  sessionStore.sessions = [createSession(session)];
  sessionStore.currentSessionId = 'session-1';
  await useContentStore().refresh();

  return persona;
}

describe('专员清单', () => {
  it('清单尚未载入或专员已停用时，把当前身份补进列表', () => {
    expect(buildPersonaOptions([], 'companion')).toEqual([{ id: 'companion', name: '创作伙伴' }]);
    // 停用的专员不在清单里，但当前会话确实在用它：选择器必须显示真实身份，而不是空值。
    expect(buildPersonaOptions([], 'scene-helper')).toEqual([{ id: 'scene-helper', name: 'scene-helper · 不可用' }]);
  });
  it('清单里已有当前专员时不重复补项', () => {
    const loaded = [
      { id: 'companion', name: '创作伙伴' },
      { id: 'scene-helper', name: '场景助手' }
    ];

    expect(buildPersonaOptions(loaded, 'scene-helper')).toEqual(loaded);
  });
});

describe('切换专员', () => {
  it('空会话切换不打扰作者，直接新建会话并落盘专员', async () => {
    const api = installDesktopMock([createPersonaEntry('scene-helper', '场景助手')]);
    const persona = await mountPersona();

    persona.requestSwitch('scene-helper');

    await vi.waitFor(() => expect(api.session.create).toHaveBeenCalled());
    expect(api.session.create).toHaveBeenCalledWith({ name: '新会话 2', personaId: 'scene-helper' });
    expect(persona.pendingPersonaId.value).toBeNull();
  });
  it('已有消息的会话先确认，确认之前不落盘任何会话', async () => {
    const api = installDesktopMock([createPersonaEntry('scene-helper', '场景助手')]);
    const persona = await mountPersona({ messageCount: 3, personaId: 'companion' });

    persona.requestSwitch('scene-helper');

    expect(persona.pendingPersonaId.value).toBe('scene-helper');
    expect(persona.pendingPersonaName.value).toBe('场景助手');
    expect(api.session.create).not.toHaveBeenCalled();

    await persona.confirmSwitch();

    expect(api.session.create).toHaveBeenCalledWith({ name: '新会话 2', personaId: 'scene-helper' });
    expect(persona.pendingPersonaId.value).toBeNull();
  });
  it('取消确认后既不新建会话，也不留下挂起状态', async () => {
    const api = installDesktopMock([createPersonaEntry('scene-helper', '场景助手')]);
    const persona = await mountPersona({ messageCount: 3 });

    persona.requestSwitch('scene-helper');
    persona.syncSwitchDialog(false);

    expect(persona.isSwitchPromptOpen.value).toBe(false);
    expect(api.session.create).not.toHaveBeenCalled();
  });
  it('确认时不受「关弹窗先于 confirm」的影响', async () => {
    // AlertDialogAction 先关弹窗再冒泡 confirm；开关与目标共用一份状态时，
    // 这里就会因为目标被清空而默默什么都不做——这条检查把它钉住。
    const api = installDesktopMock([createPersonaEntry('scene-helper', '场景助手')]);
    const persona = await mountPersona({ messageCount: 3 });

    persona.requestSwitch('scene-helper');
    persona.syncSwitchDialog(false);
    await persona.confirmSwitch();

    expect(api.session.create).toHaveBeenCalledWith({ name: '新会话 2', personaId: 'scene-helper' });
  });
  it('选回当前专员不新建会话', async () => {
    const api = installDesktopMock([createPersonaEntry('scene-helper', '场景助手')]);
    const persona = await mountPersona({ messageCount: 3, personaId: 'scene-helper' });

    persona.requestSwitch('scene-helper');

    expect(persona.pendingPersonaId.value).toBeNull();
    expect(api.session.create).not.toHaveBeenCalled();
  });
  it('切回默认专员时不把默认身份写进会话元数据', async () => {
    const api = installDesktopMock([createPersonaEntry('scene-helper', '场景助手')]);
    const persona = await mountPersona({ messageCount: 0, personaId: 'scene-helper' });

    persona.requestSwitch('companion');

    await vi.waitFor(() => expect(api.session.create).toHaveBeenCalled());
    expect(api.session.create).toHaveBeenCalledWith({ name: '新会话 2' });
  });
  it('「管理专员」打开设置面板，不换会话', async () => {
    const api = installDesktopMock([]);
    const persona = await mountPersona({ messageCount: 3 });
    const settings = useSettingsStore();

    persona.requestSwitch('__manage');

    expect(settings.isOpen).toBe(true);
    expect(settings.activeSection).toBe('content');
    expect(api.session.create).not.toHaveBeenCalled();
  });
});
