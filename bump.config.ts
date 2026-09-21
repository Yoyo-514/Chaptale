import { defineConfig } from 'bumpp';

export default defineConfig({
  // 两处版本必须同步：check-release.mjs 断言根包与桌面包版本一致。
  files: ['package.json', 'apps/desktop/package.json'],
  // bumpp 默认跳过干净工作树检查；发布前需要这道前置校验。
  noGitCheck: false,
  // check-release.mjs 要求标签严格等于 v<version>，显式写出而不依赖默认值。
  tag: 'v{version}',
  commit: 'chore(release): v{version}',
  push: true
});
