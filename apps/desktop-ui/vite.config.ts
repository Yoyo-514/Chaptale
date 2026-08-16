import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import UnoCSS from 'unocss/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

/**
 * 生产构建收窄 CSP：开发期需要 localhost websocket（HMR/事件流）外联，
 * 打包产物不再放行本地端口，封住应用内数据外泄通道。
 */
function cspForProduction(): Plugin {
  return {
    name: 'chaptale:csp-prod',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace("connect-src 'self' http://localhost:* ws://localhost:*", "connect-src 'self'");
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [UnoCSS(), vue(), cspForProduction()],
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
