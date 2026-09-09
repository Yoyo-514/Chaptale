import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import UnoCSS from 'unocss/vite';
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron/simple';

const desktopRoot = import.meta.dirname;
const rendererRoot = path.resolve(desktopRoot, '../desktop-ui');
const ipcPackageRoot = path.resolve(desktopRoot, '../../packages/ipc/src');

const workspaceAliases = [
  {
    find: '@chaptale/shared/document-frontmatter',
    replacement: path.resolve(desktopRoot, '../../packages/shared/src/document-frontmatter.ts')
  },
  {
    find: '@chaptale/ipc-contract/channels',
    replacement: path.resolve(ipcPackageRoot, 'channels.ts')
  },
  {
    find: '@chaptale/ipc-contract',
    replacement: path.resolve(ipcPackageRoot, 'index.ts')
  },
  {
    find: '@chaptale/shared',
    replacement: path.resolve(desktopRoot, '../../packages/shared/src/index.ts')
  }
];

export default defineConfig(async () => ({
  root: rendererRoot,
  plugins: [
    UnoCSS({ configFile: path.resolve(rendererRoot, 'uno.config.ts') }),
    vue(),
    ...(await electron({
      main: {
        entry: {
          index: path.resolve(desktopRoot, 'src/main/index.ts'),
          'index-worker': path.resolve(desktopRoot, 'src/main/features/search/index/worker-entry.ts')
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
              external: ['@node-rs/jieba', '@node-rs/jieba/dict']
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
