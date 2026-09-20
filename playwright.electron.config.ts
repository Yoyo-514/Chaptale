import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/electron',
  timeout: 30_000,
  expect: {
    timeout: 8_000
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['junit', { outputFile: 'test-results/electron.xml' }]],
  use: {
    trace: 'retain-on-failure'
  }
});
