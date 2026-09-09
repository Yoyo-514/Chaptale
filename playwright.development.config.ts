import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/development',
  outputDir: './temp/test-results/development',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm --filter @chaptale/desktop-ui dev --host localhost --port 4318 --strictPort',
    url: 'http://localhost:4318',
    reuseExistingServer: false,
    timeout: 60_000
  }
});
