import type { Plugin } from 'vite';

/**
 * 独立 UI 与 Electron 构建共用同一 CSP。
 * 仅开发服务器放行 HMR；业务联网始终经受校验的 IPC 进入主进程。
 */
export function rendererSecurity(): Plugin {
  let development = false;

  return {
    name: 'chaptale:renderer-security',
    configResolved(config) {
      development = config.command === 'serve';
    },
    transformIndexHtml() {
      const connections = development ? "'self' http://localhost:* ws://localhost:*" : "'self'";
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: [
              "default-src 'self'",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              `connect-src ${connections}`,
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'none'"
            ].join('; ')
          },
          injectTo: 'head-prepend'
        }
      ];
    }
  };
}
