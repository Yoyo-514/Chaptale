import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('桌面跨包构建', () => {
  it('缓存键包含实际编译的 renderer 源码、静态资源和构建插件', async () => {
    const root = path.resolve(import.meta.dirname, '../../../../../..');
    const config = JSON.parse(await readFile(path.join(root, 'turbo.json'), 'utf8'));
    const inputs: string[] = config.tasks['@chaptale/desktop#build'].inputs;
    expect(inputs).toEqual(
      expect.arrayContaining([
        '$TURBO_DEFAULT$',
        '$TURBO_ROOT$/apps/desktop-ui/src/**',
        '$TURBO_ROOT$/apps/desktop-ui/public/**',
        '$TURBO_ROOT$/apps/desktop-ui/build/**',
        '$TURBO_ROOT$/apps/desktop-ui/index.html',
        '$TURBO_ROOT$/apps/desktop-ui/uno.config.ts'
      ])
    );
    expect(config.tasks['@chaptale/desktop#typecheck'].inputs).toContain('$TURBO_ROOT$/apps/desktop-ui/build/**');
  });
});
