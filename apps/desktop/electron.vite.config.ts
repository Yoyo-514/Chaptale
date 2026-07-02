import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'electron-vite';
import path from 'node:path';
import UnoCSS from 'unocss/vite';

const appRoot = path.resolve(__dirname, '../desktop-ui');

export default defineConfig({
  main: {
    build: {
      outDir: path.resolve(__dirname, 'dist/main'),
      rollupOptions: {
        input: path.resolve(__dirname, 'src/main/index.ts'),
        external: ['electron']
      }
    }
  },
  preload: {
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
