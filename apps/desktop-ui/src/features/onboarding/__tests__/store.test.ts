import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { ONBOARDING_VERSION, useOnboardingStore } from '../store';

beforeEach(() => setActivePinia(createPinia()));
describe('开始引导状态', () => {
  it('旧设置首次显示，关闭后设置刷新不会反复弹出', () => {
    const guide = useOnboardingStore();
    guide.consider(undefined);
    expect(guide.isOpen).toBe(true);
    guide.isOpen = false;
    guide.consider(0);
    expect(guide.isOpen).toBe(false);
  });
  it('完成标记只控制自动显示，帮助入口仍能重进', () => {
    const guide = useOnboardingStore();
    guide.consider(ONBOARDING_VERSION);
    expect(guide.isOpen).toBe(false);
    guide.step = 'assistant';
    guide.show();
    expect(guide.isOpen).toBe(true);
    expect(guide.step).toBe('workspace');
  });
  it('未来版本不被当作未完成', () => {
    const guide = useOnboardingStore();
    guide.consider(ONBOARDING_VERSION + 1);
    expect(guide.isOpen).toBe(false);
  });
});
