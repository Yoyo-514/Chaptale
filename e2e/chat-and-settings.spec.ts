import { expect, test, type Page } from '@playwright/test';

async function installDesktopMock(page: Page) {
  await page.addInitScript(() => {
    const now = new Date('2026-07-06T00:00:00Z').toISOString();
    let webSearchEnabled = true;
    let entries: any[] = [];
    const calls: { settingsUpdates: any[]; cancelledRuns: string[]; streamOptions: any[]; imageReads: any[] } = {
      settingsUpdates: [],
      cancelledRuns: [],
      streamOptions: [],
      imageReads: []
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
        readImage: async (payload: any) => {
          calls.imageReads.push(payload);
          return { data: new Uint8Array([97, 98, 99]), mimeType: 'image/png' };
        },
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
        selectContextFiles: async () => [
          {
            path: 'C:/novel/outline.md',
            name: 'outline.md',
            size: 2048,
            kind: 'text'
          },
          ...Array.from({ length: 9 }, (_, index) => ({
            path: `C:/novel/cover-${index}.png`,
            name: `cover-${index}.png`,
            size: 3,
            kind: 'image',
            mimeType: 'image/png',
            previewDataUrl: 'data:image/png;base64,YWJj',
            imageWidth: 100,
            imageHeight: 80
          }))
        ],
        inspectContextFiles: async () => [],
        getPathForFile: () => '',
        stream: async (query: string, handlers: any, _sessionId: string, options: any) => {
          calls.streamOptions.push(options);
          const contextFilePaths = options?.contextFilePaths ?? [];
          const imagePaths = contextFilePaths.filter((filePath: string) => filePath.endsWith('.png'));
          const contextFiles = contextFilePaths
            .filter((filePath: string) => !filePath.endsWith('.png'))
            .map((filePath: string) => ({
              path: filePath,
              name: filePath.split(/[\\/]/).at(-1) ?? filePath,
              size: 2048,
              kind: 'text'
            }));
          const userId = `user-${entries.length + 1}`;
          const userContent = imagePaths.length
            ? [
                { type: 'text', text: query },
                ...imagePaths.map((_filePath: string, index: number) => ({
                  type: 'imageAttachment',
                  id: `${userId}:${index + 1}`,
                  mimeType: 'image/png',
                  originalBytes: 3,
                  width: 100,
                  height: 80,
                  thumbnailDataUrl: 'data:image/png;base64,YWJj',
                  source: {
                    type: 'session-entry',
                    sessionId: 'session-1',
                    entryId: userId,
                    blockIndex: index + 1
                  }
                }))
              ]
            : query;
          const userEntry = {
            type: 'message',
            id: userId,
            parentId: entries.at(-1)?.id ?? null,
            timestamp: now,
            message: { role: 'user', content: userContent, contextFiles, timestamp: Date.now() }
          };
          entries.push(userEntry);
          handlers.onMessage(userEntry.message);

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
          }, 300);
          setTimeout(() => {
            entries.push({
              type: 'message',
              id: `assistant-${entries.length + 1}`,
              parentId: userEntry.id,
              timestamp: now,
              message: { role: 'assistant', content: [{ type: 'text', text: `收到：${query}` }], timestamp: Date.now() }
            });
            handlers.onDone();
          }, 700);
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

  await expect(page.getByText('写一段开场', { exact: true })).toBeVisible();
  await expect(page.locator('.assistant-streaming-indicator')).toBeVisible();
  await expect(page.getByText('收到：写一段开场')).toBeVisible();
});

test('mixed attachments keep compact tiles in the input while sent images render as a large gallery', async ({
  page
}) => {
  await page.goto('/');

  await page.getByRole('button', { name: '添加文件' }).click();
  await expect(page.getByText('outline.md')).toBeVisible();
  await expect(page.locator('.chat-context-attachments-input .app-image-thumbnail-grid')).toBeVisible();
  await expect(page.locator('.chat-context-attachments-input .app-image-thumbnail-item')).toHaveCount(9);
  await expect(page.locator('.chat-context-attachments-input .chat-context-file-card')).toHaveCount(1);

  await page.getByPlaceholder('描述你的创作需求...').fill('检查附件');
  await page.locator('.chat-send-button').click();

  await expect
    .poll(() => page.evaluate(() => (window as any).chaptaleE2E.streamOptions.at(-1)?.contextFilePaths))
    .toEqual(['C:/novel/outline.md', ...Array.from({ length: 9 }, (_, index) => `C:/novel/cover-${index}.png`)]);
  await expect(page.locator('.message-container-user .chat-context-file-card')).toContainText('outline.md');
  await expect(page.locator('.message-container-user .app-image-gallery')).toBeVisible();
  await expect(page.locator('.message-container-user .app-image-gallery-item')).toHaveCount(9);
  await expect(page.locator('.message-container-user .app-image-gallery-count')).toHaveText('共 9 张');
  const galleryImage = page.locator('.message-container-user .app-image-gallery-image').first();
  await expect(galleryImage).toHaveAttribute('src', 'data:image/png;base64,YWJj');
  await page.getByRole('button', { name: '预览 用户上传的图片 1' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).chaptaleE2E.imageReads.length)).toBe(1);
  await expect(page.getByText('1 / 9')).toBeVisible();
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
