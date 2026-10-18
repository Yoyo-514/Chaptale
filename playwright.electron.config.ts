import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/electron',
  timeout: 30_000,
  expect: {
    timeout: 8_000
  },
  // 每个用例都有独立的临时主目录和 Electron 实例，可以并行。
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list'], ['junit', { outputFile: 'test-results/electron.xml' }]],
  use: {
    trace: 'retain-on-failure'
  }
});
