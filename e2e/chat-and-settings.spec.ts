import { expect, test, type Page } from '@playwright/test';

async function installDesktopMock(page: Page) {
  await page.addInitScript(() => {
    const now = new Date('2026-07-06T00:00:00Z').toISOString();
    let webSearchEnabled = true;
    let entries: any[] = [];
    const calls: { settingsUpdates: any[]; cancelledRuns: string[] } = {
      settingsUpdates: [],
      cancelledRuns: []
    };

    function settingsState() {
      return {
        settings: {
          version: 1,
          storage: { mode: 'global' }
        },
        webAccess: {
          webSearchEnabled,
          provider: 'auto',
          workflow: 'none',
          allowBrowserCookies: false,
          curatorTimeoutSeconds: 20,
          githubClone: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
          youtube: { enabled: true, preferredModel: 'gemini-3-flash-preview' },
          video: { enabled: true, preferredModel: 'gemini-3-flash-preview', maxSizeMB: 50 },
          ssrf: { allowRanges: [] }
        },
        paths: {
          rootDir: 'C:/Users/Test/.chaptale',
          agentDir: 'C:/Users/Test/.chaptale/agent',
          settingsPath: 'C:/Users/Test/.chaptale/settings.json',
          piSettingsPath: 'C:/Users/Test/.chaptale/agent/settings.json',
          piModelsPath: 'C:/Users/Test/.chaptale/agent/models.json',
          piAuthPath: 'C:/Users/Test/.chaptale/agent/auth.json',
          piWebAccessConfigPath: 'C:/Users/Test/.chaptale/agent/web-search.json',
          sessionsRootDir: 'C:/Users/Test/.chaptale/agent/sessions',
          effectiveSessionDir: 'C:/Users/Test/.chaptale/agent/sessions/global'
        }
      };
    }

    function sessionList() {
      return [
        {
          id: 'session-1',
          createdAt: now,
          updatedAt: now,
          cwd: 'E:/backend-study/Chaptale',
          path: 'session.jsonl',
          leafId: entries.at(-1)?.id ?? null,
          messageCount: entries.length,
          scope: 'global',
          totalTokens: 0,
          totalCost: 0
        }
      ];
    }

    (window as any).chaptaleE2E = calls;
    (window as any).chaptaleDesktop = {
      getPlatform: async () => ({ platform: 'win32', versions: {} }),
      windowControl: {
        minimize: async () => ({ isMaximized: false }),
        toggleMaximize: async () => ({ isMaximized: false }),
        close: async () => undefined,
        isMaximized: async () => ({ isMaximized: false })
      },
      session: {
        list: async () => sessionList(),
        create: async () => ({
          id: 'session-1',
          createdAt: now,
          cwd: 'E:/backend-study/Chaptale',
          path: 'session.jsonl'
        }),
        getEntries: async () => entries,
        getMessages: async () => entries.map(entry => entry.message),
        rename: async () => ({ type: 'session_info', id: 'info-1', parentId: null, timestamp: now, name: 'Renamed' }),
        delete: async () => undefined,
        deleteMany: async () => undefined,
        setLeaf: async () => undefined,
        getStorageDebugInfo: async () => ({
          rootDir: 'C:/Users/Test/.chaptale',
          sessionDir: 'C:/Users/Test/.chaptale/agent/sessions/global',
          cwd: 'E:/backend-study/Chaptale',
          storageMode: 'global'
        }),
        openStorageDir: async () => undefined
      },
      settings: {
        getState: async () => settingsState(),
        update: async (payload: any) => {
          calls.settingsUpdates.push(payload);
          return settingsState();
        },
        updateWebAccess: async (payload: any) => {
          calls.settingsUpdates.push(payload);
          if (typeof payload.webSearchEnabled === 'boolean') {
            webSearchEnabled = payload.webSearchEnabled;
          }
          return settingsState();
        },
        selectWorkspaceDir: async () => ({ canceled: true }),
        openConfigDir: async () => undefined
      },
      models: {
        list: async () => ({ providers: [], models: [], defaultModel: undefined }),
        setDefault: async () => ({ providers: [], models: [], defaultModel: undefined }),
        setProviderApiKey: async () => ({ providers: [], models: [], defaultModel: undefined }),
        fetchCustomProviderModels: async () => ({ models: [] }),
        addCustomProvider: async () => ({ providers: [], models: [], defaultModel: undefined }),
        addCustomModel: async () => ({ providers: [], models: [], defaultModel: undefined }),
        setCustomProviderApiKey: async () => ({ providers: [], models: [], defaultModel: undefined }),
        removeCustomProviderApiKey: async () => ({ providers: [], models: [], defaultModel: undefined }),
        updateCustomModelInput: async () => ({ providers: [], models: [], defaultModel: undefined }),
        removeCustomModel: async () => ({ providers: [], models: [], defaultModel: undefined }),
        removeProviderAuth: async () => ({ providers: [], models: [], defaultModel: undefined })
      },
      agent: {
        stream: async (query: string, handlers: any) => {
          const userEntry = {
            type: 'message',
            id: `user-${entries.length + 1}`,
            parentId: entries.at(-1)?.id ?? null,
            timestamp: now,
            message: { role: 'user', content: query, timestamp: Date.now() }
          };
          entries.push(userEntry);

          if (query.includes('失败')) {
            setTimeout(() => {
              handlers.onError(`模拟失败：${query}`);
            }, 80);
            return { runId: `run-${entries.length}` };
          }

          setTimeout(() => {
            handlers.onMessage({
              role: 'assistant',
              partial: true,
              content: [{ type: 'text', text: `收到：${query}` }],
              timestamp: Date.now()
            });
          }, 80);
          setTimeout(() => {
            entries.push({
              type: 'message',
              id: `assistant-${entries.length + 1}`,
              parentId: userEntry.id,
              timestamp: now,
              message: { role: 'assistant', content: [{ type: 'text', text: `收到：${query}` }], timestamp: Date.now() }
            });
            handlers.onDone();
          }, 140);
          return { runId: 'run-1' };
        },
        cancel: async (runId: string) => {
          calls.cancelledRuns.push(runId);
          return { runId };
        }
      }
    };
  });
}

test.beforeEach(async ({ page }) => {
  await installDesktopMock(page);
});

test('sending a prompt shows immediate generation feedback and then the assistant reply', async ({ page }) => {
  await page.goto('/');

  await page.getByPlaceholder('描述你的创作需求...').fill('写一段开场');
  await page.locator('.chat-send-button').click();

  await expect(page.getByText('写一段开场')).toBeVisible();
  await expect(page.locator('.assistant-streaming-indicator')).toBeVisible();
  await expect(page.getByText('收到：写一段开场')).toBeVisible();
});

test('web search toggle updates settings and stays in sync with the settings panel', async ({ page }) => {
  await page.goto('/');

  const webSearchButton = page.getByRole('button', { name: /联网|离线/ });
  await expect(webSearchButton).toHaveAttribute('aria-pressed', 'true');
  await webSearchButton.click();
  await expect(webSearchButton).toHaveAttribute('aria-pressed', 'false');
  await expect(webSearchButton).toContainText('离线');

  await expect
    .poll(() => page.evaluate(() => (window as any).chaptaleE2E.settingsUpdates.at(-1)))
    .toEqual({ webSearchEnabled: false });

  await page.getByLabel('打开设置').click();
  await page.getByRole('button', { name: /联网/ }).click();

  await expect(page.getByRole('heading', { name: '联网与内容提取' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /启用联网搜索/ })).toHaveAttribute('aria-checked', 'false');
});

test('auto notification popup only shows unseen notifications after the center is opened', async ({ page }) => {
  await page.goto('/');

  await page.getByPlaceholder('描述你的创作需求...').fill('第一次失败');
  await page.locator('.chat-send-button').click();

  const notificationCenter = page.locator('.notification-center');
  await expect(notificationCenter).toContainText('模拟失败：第一次失败');

  // 用户主动点开通知中心后，现有通知都视为已看过。
  await page.getByLabel('打开通知中心').click();
  await expect(page.locator('.notification-count')).toHaveCount(0);

  // 关闭手动面板，后续由新通知触发自动弹出。
  await page.getByLabel('打开通知中心').click();
  await expect(notificationCenter).toBeHidden();

  await page.getByPlaceholder('描述你的创作需求...').fill('第二次失败');
  await page.locator('.chat-send-button').click();

  await expect(notificationCenter).toBeVisible();
  await expect(notificationCenter).toContainText('模拟失败：第二次失败');
  await expect(notificationCenter).not.toContainText('模拟失败：第一次失败');
  await expect(page.locator('.notification-count')).toHaveText('1');
});
