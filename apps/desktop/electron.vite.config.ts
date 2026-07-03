import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'electron-vite';
import path from 'node:path';
import UnoCSS from 'unocss/vite';

const appRoot = path.resolve(__dirname, '../desktop-ui');
const workspaceAliases = {
  '@chaptale/ipc-contract': path.resolve(__dirname, '../../packages/ipc-contract/src/index.ts'),
  '@chaptale/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts')
};

export default defineConfig({
  main: {
    resolve: {
      alias: workspaceAliases
    },
    build: {
      outDir: path.resolve(__dirname, 'dist/main'),
      rollupOptions: {
        input: path.resolve(__dirname, 'src/main/index.ts'),
        external: ['electron']
      }
    }
  },
  preload: {
    resolve: {
      alias: workspaceAliases
    },
    build: {
      outDir: path.resolve(__dirname, 'dist/preload'),
      rollupOptions: {
        input: path.resolve(__dirname, 'src/preload/index.ts'),
        external: ['electron']
      }
    }
  },
  renderer: {
    root: appRoot,
    plugins: [UnoCSS({ configFile: path.resolve(appRoot, 'uno.config.ts') }), vue()],
    resolve: {
      alias: {
        ...workspaceAliases,
        '@': path.resolve(appRoot, 'src')
      }
    },
    build: {
      outDir: path.resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: path.resolve(appRoot, 'index.html')
      }
    }
  }
});
