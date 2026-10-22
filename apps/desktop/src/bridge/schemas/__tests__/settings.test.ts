import { describe, expect, it } from 'vitest';

import { UpdateChaptaleSettingsArgsValidator } from '../settings';

describe('设置参数 Schema', () => {
  it('只接受编辑器与主题的部分更新，拒绝未知字段', () => {
    expect(UpdateChaptaleSettingsArgsValidator.Check([{}])).toBe(true);
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ editor: { autoSave: true } }])).toBe(true);
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ theme: 'warm' }])).toBe(true);
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ editor: { autoSave: 'yes' } }])).toBe(false);
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ theme: 'blue' }])).toBe(false);
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ workspace: { path: '/tmp' } }])).toBe(false);
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ extra: true }])).toBe(false);
  });
});
