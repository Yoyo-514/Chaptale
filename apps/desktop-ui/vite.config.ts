import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import UnoCSS from 'unocss/vite';
import { defineConfig } from 'vite';

import { rendererSecurity } from './build/renderer-security.ts';

// https://vite.dev/config/
export default defineConfig({
  plugins: [UnoCSS(), vue(), rendererSecurity()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src')
    }
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, '')
      }
    }
  }
});
