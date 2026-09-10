import { describe, expect, it } from 'vitest';

import { SceneReferencesValidator } from '../../library';
import { CreateAssetValidator } from '../../templates';
describe('模板和场景 IPC', () => {
  it('创建绑定模板 hash，拒绝未知字段和目录逃逸', () => {
    const args = {
      rootPath: 'E:/book',
      templateId: 'scene-card',
      templateHash: 'a'.repeat(64),
      filename: '场景.md',
      values: { title: '场景', cast: ['[[甲]]'], settled: false }
    };
    expect(CreateAssetValidator.Check([args])).toBe(true);
    expect(CreateAssetValidator.Check([{ ...args, directory: '../escape' }])).toBe(false);
    expect(CreateAssetValidator.Check([{ ...args, content: '未经模板验证的正文' }])).toBe(false);
    expect(CreateAssetValidator.Check([{ ...args, templateHash: '' }])).toBe(false);
  });
  it('参考选择和排除只接受有界作品相对路径', () => {
    const args = { rootPath: 'E:/book', scenePath: '大纲/场景卡/一.md', selections: [], excluded: [] };
    expect(SceneReferencesValidator.Check([args])).toBe(true);
    expect(SceneReferencesValidator.Check([{ ...args, excluded: ['C:/outside.md'] }])).toBe(false);
    expect(SceneReferencesValidator.Check([{ ...args, goal: '覆盖模型协议' }])).toBe(false);
  });
});
