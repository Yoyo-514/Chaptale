import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'electron-vite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import UnoCSS from 'unocss/vite';

const appRoot = path.resolve(__dirname, '../desktop-ui');
const workspaceAliases = {
  '@chaptale/ipc-contract': path.resolve(__dirname, '../../packages/ipc/src/index.ts'),
  '@chaptale/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts')
};

// workspace 包以 TS 源码别名方式参与构建，必须打进 bundle；
// 其余 dependencies 保持 external，由运行时 node_modules 提供。
// 全量打包会触发 rolldown 在大依赖图下丢弃入口 chunk 的问题
// （表现为 dist/main/index.js 为 0 字节，Electron 窗口无法启动）。
// 注：不使用 build.externalizeDeps —— 实测在 electron-vite 5.0.0 + vite 8 下该选项未生效，
// 最终 rollup external 仍只包含用户显式配置的值，故改为手动从 package.json 生成 external 列表。
const bundledWorkspacePackages = new Set(['@chaptale/ipc-contract', '@chaptale/shared']);
const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
};
const externalDeps = Object.keys(packageJson.dependencies ?? {}).filter(name => !bundledWorkspacePackages.has(name));
const nodeExternals = [
  'electron',
  ...externalDeps,
  new RegExp(`^(${externalDeps.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})/`)
];

export default defineConfig({
  main: {
    resolve: {
      alias: workspaceAliases
    },
    build: {
      outDir: path.resolve(__dirname, 'dist/main'),
      rollupOptions: {
        input: path.resolve(__dirname, 'src/main/index.ts'),
        external: nodeExternals
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
        external: nodeExternals
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
