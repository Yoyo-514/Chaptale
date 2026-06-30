import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { defineConfig, defineProject } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      defineProject({
        plugins: [vue()],
        resolve: {
          alias: {
            '@': path.resolve(__dirname, './apps/app/src')
          }
        },
        test: {
          name: 'app',
          root: './apps/app',
          environment: 'happy-dom',
          include: ['src/**/*.test.ts']
        }
      }),
      defineProject({
        test: {
          name: 'desktop',
          root: './apps/desktop',
          environment: 'node',
          include: ['src/**/*.test.ts']
        }
      })
    ]
  }
});
