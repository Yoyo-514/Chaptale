import { defineConfig, devices } from '@playwright/test';

const localBrowserChannel = process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? undefined : 'msedge');

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 8_000
  },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry'
  },
  webServer: {
    command: 'pnpm --dir apps/desktop-ui exec vite --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: localBrowserChannel }
    }
  ]
});
