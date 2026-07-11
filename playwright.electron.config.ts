import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/electron',
  timeout: 30_000,
  expect: {
    timeout: 8_000
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'on-first-retry'
  }
});
