import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { defineConfig, defineProject } from 'vitest/config';

export const vitestProjects = [
  defineProject({
    plugins: [vue()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './apps/desktop-ui/src')
      }
    },
    test: {
      name: 'ui',
      root: './apps/desktop-ui',
      environment: 'happy-dom',
      include: ['src/**/*.test.ts']
    }
  }),
  defineProject({
    test: {
      name: 'desktop',
      root: './apps/desktop',
      environment: 'node',
      // 真实文件事务与 watcher 共用磁盘，过多 worker 会让校验时限变成磁盘竞争测试。
      maxWorkers: 2,
      include: ['src/**/*.test.ts']
    }
  }),
  defineProject({
    test: {
      name: 'shared',
      root: './packages/shared',
      environment: 'node',
      include: ['src/**/*.test.ts']
    }
  }),
  defineProject({
    test: {
      name: 'ipc',
      root: './packages/ipc',
      environment: 'node',
      include: ['src/**/*.test.ts']
    }
  })
];

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'apps/desktop/src/main/**/*.ts',
        'apps/desktop-ui/src/{features,components,composables,utils}/**/*.ts',
        'packages/shared/src/**/*.ts'
      ],
      exclude: [
        '**/__tests__/**',
        '**/*.d.ts',
        '**/*.types.ts',
        '**/types.ts',
        '**/*.config.*',
        '**/index.ts',

        // Runtime / integration boundaries are covered by typecheck, integration behavior, and E2E.
        '**/ipc/**',
        '**/preload/**',
        '**/*.factory.ts',
        '**/services/*model.service.ts',
        '**/infra/dialog-gateway.ts',
        '**/infra/shell-gateway.ts',

        // Type-only contract packages are validated by TypeScript and package consumers.
        'packages/ipc/src/**'
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 85,
        lines: 80
      }
    },
    projects: vitestProjects
  }
});
