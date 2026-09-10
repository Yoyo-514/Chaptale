import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { ONBOARDING_VERSION, useOnboardingStore } from '../store';

beforeEach(() => setActivePinia(createPinia()));
describe('首启判定', () => {
  it('未完成过的设置需要提示，完成过的与未来版本都不提示', () => {
    expect(useOnboardingStore().consider(undefined)).toBe(true);

    setActivePinia(createPinia());
    expect(useOnboardingStore().consider(0)).toBe(true);

    setActivePinia(createPinia());
    expect(useOnboardingStore().consider(ONBOARDING_VERSION)).toBe(false);

    setActivePinia(createPinia());
    expect(useOnboardingStore().consider(ONBOARDING_VERSION + 1)).toBe(false);
  });
  it('同一次运行内只判定一次，设置刷新不会重复弹出', () => {
    const guide = useOnboardingStore();
    expect(guide.consider(0)).toBe(true);
    expect(guide.consider(0)).toBe(false);
    expect(guide.consider(undefined)).toBe(false);
  });
});
