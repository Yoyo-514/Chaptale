import type { ComputedRef, InjectionKey } from 'vue';

export type AppFormContext = {
  disabled: ComputedRef<boolean>;
};

export const appFormContextKey: InjectionKey<AppFormContext> = Symbol('app-form-context');
