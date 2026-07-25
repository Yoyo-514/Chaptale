import { defineConfig } from 'vitest/config';

import { vitestProjects } from './vitest.config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage/all',
      include: [
        'apps/desktop/src/main/**/*.ts',
        'apps/desktop/src/preload/**/*.ts',
        'apps/desktop-ui/src/**/*.{ts,vue}',
        'packages/shared/src/**/*.ts',
        'packages/ipc/src/**/*.ts'
      ],
      exclude: ['**/__tests__/**', '**/*.d.ts', '**/*.types.ts', '**/types.ts', '**/*.config.*', '**/index.ts'],
      thresholds: {
        statements: 77,
        branches: 68,
        functions: 72,
        lines: 77
      }
    },
    projects: vitestProjects
  }
});
