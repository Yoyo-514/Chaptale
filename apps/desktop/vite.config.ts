import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import UnoCSS from 'unocss/vite';
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron/simple';

import { rendererSecurity } from '../desktop-ui/build/renderer-security.ts';

const desktopRoot = import.meta.dirname;
const rendererRoot = path.resolve(desktopRoot, '../desktop-ui');

const agentHostRoot = path.resolve(desktopRoot, '../../packages/agent-host/src');
const workspaceAliases = [
  { find: '@chaptale/agent-host/protocol', replacement: path.join(agentHostRoot, 'protocol.ts') },
  { find: '@chaptale/ui/client', replacement: path.resolve(desktopRoot, '../../packages/ui/src/client/connection.ts') },
  { find: '@chaptale/agent-host/application', replacement: path.join(agentHostRoot, 'application/index.ts') },
  { find: '@chaptale/agent-host', replacement: path.join(agentHostRoot, 'index.ts') },
  { find: '@chaptale/desktop/bridge', replacement: path.resolve(desktopRoot, 'src/bridge/index.ts') }
];

export default defineConfig(async () => ({
  root: rendererRoot,
  plugins: [
    UnoCSS({ configFile: path.resolve(rendererRoot, 'uno.config.ts') }),
    vue(),
    rendererSecurity(),
    ...(await electron({
      main: {
        entry: {
          index: path.resolve(desktopRoot, 'src/main/index.ts'),
          'application-host': path.resolve(desktopRoot, 'src/main/application-host/worker.ts')
        },
        onstart: async ({ startup }) => {
          await startup(['.'], { cwd: desktopRoot });
        },
        vite: {
          root: desktopRoot,
          resolve: {
            alias: workspaceAliases
          },
          build: {
            outDir: path.resolve(desktopRoot, 'dist/main'),
            emptyOutDir: true,
            rolldownOptions: {
              external: [
                '@earendil-works/pi-coding-agent',
                'better-sqlite3',
                '@node-rs/jieba',
                '@node-rs/jieba/dict.js'
              ]
            }
          }
        }
      },
      preload: {
        input: path.resolve(desktopRoot, 'src/preload/index.ts'),
        vite: {
          root: desktopRoot,
          resolve: {
            alias: workspaceAliases
          },
          build: {
            outDir: path.resolve(desktopRoot, 'dist/preload'),
            emptyOutDir: true
          }
        }
      }
    }))
  ],
  resolve: {
    alias: [
      ...workspaceAliases,
      {
        find: '@',
        replacement: path.resolve(rendererRoot, 'src')
      }
    ]
  },
  build: {
    outDir: path.resolve(desktopRoot, 'dist/renderer'),
    emptyOutDir: true,
    manifest: true,
    rolldownOptions: {
      input: path.resolve(rendererRoot, 'index.html'),
      output: {
        chunkFileNames: (chunk: { name: string }) =>
          chunk.name.startsWith('editor-engine') ? 'assets/editor-engine-[hash].js' : 'assets/[name]-[hash].js',
        codeSplitting: {
          groups: [
            {
              name: 'editor-engine',
              test: /node_modules[\\/]@codemirror[\\/](state|view|commands|language|merge)[\\/]/,
              entriesAware: true
            }
          ]
        }
      }
    }
  }
}));
