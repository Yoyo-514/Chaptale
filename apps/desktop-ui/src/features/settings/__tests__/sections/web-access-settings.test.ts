import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import { AppSelect } from '@/components/AppSelect';
import { useNotificationStore } from '@/features/notifications';

import WebAccessSettings from '../../sections/WebAccessSettings.vue';
import { useSettingsStore } from '../../store';

function createSettingsState(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      version: 1,
      storage: { mode: 'global' }
    },
    webAccess: {
      webSearchEnabled: true,
      provider: 'auto',
      workflow: 'none',
      allowBrowserCookies: false,
      curatorTimeoutSeconds: 20,
      githubClone: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
      youtube: { enabled: true, preferredModel: 'gemini-3-flash-preview' },
      video: { enabled: true, preferredModel: 'gemini-3-flash-preview', maxSizeMB: 50 },
      ssrf: { allowRanges: 'invalid' as unknown as string[] },
      ...overrides
    },
    paths: {
      rootDir: 'root',
      agentDir: 'agent',
      settingsPath: 'settings.json',
      piSettingsPath: 'agent/settings.json',
      piModelsPath: 'agent/models.json',
      piAuthPath: 'agent/auth.json',
      piWebAccessConfigPath: 'agent/web-search.json',
      sessionsRootDir: 'agent/sessions',
      effectiveSessionDir: 'agent/sessions/global'
    }
  };
}

const passthrough = defineComponent({
  setup(_, { slots }) {
    return () => h('div', slots.default?.());
  }
});

const checkboxStub = defineComponent({
  props: { modelValue: Boolean },
  emits: ['update:modelValue'],
  setup(props, { emit, slots }) {
    return () =>
      h(
        'button',
        {
          class: 'checkbox-stub',
          'aria-checked': String(props.modelValue),
          onClick: () => emit('update:modelValue', !props.modelValue)
        },
        slots.default?.()
      );
  }
});

const appNumberInputStub = defineComponent({
  props: { modelValue: Number, ariaLabel: String },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () =>
      h('input', {
        class: 'number-input-stub',
        'aria-label': props.ariaLabel,
        value: props.modelValue,
        onInput: (event: Event) => emit('update:modelValue', Number((event.target as HTMLInputElement).value))
      });
  }
});

function mountSection() {
  return mount(WebAccessSettings, {
    global: {
      stubs: {
        CheckboxRoot: checkboxStub,
        CheckboxIndicator: passthrough,
        CollapsibleRoot: passthrough,
        CollapsibleContent: passthrough,
        CollapsibleTrigger: passthrough,
        AppNumberInput: appNumberInputStub
      }
    }
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.restoreAllMocks();
});

describe('WebAccessSettings', () => {
  it('normalizes settings into a draft and renders provider/workflow choices', () => {
    const settingsStore = useSettingsStore();
    settingsStore.state = createSettingsState({
      provider: 'gemini',
      workflow: 'summary-review',
      braveApiKey: 'brave-key'
    }) as any;

    const wrapper = mountSection();

    expect(wrapper.text()).toContain('联网与内容提取');
    expect(wrapper.text()).toContain('Gemini');
    expect(wrapper.text()).toContain('浏览器筛选');
    expect(wrapper.text()).toContain('Gemini Base URL');
    const timeoutField = wrapper
      .findAll('[data-slot="app-form-field"]')
      .find(field => field.text().includes('浏览器筛选超时（秒）'));
    expect(timeoutField?.find('input').exists()).toBe(true);
    expect(timeoutField?.find('label').attributes('for')).toBe(timeoutField?.find('input').attributes('id'));
  });

  it('updates draft values through controls and does not notify success when save fails', async () => {
    const settingsStore = useSettingsStore();
    settingsStore.state = createSettingsState() as any;
    const updateWebAccess = vi.spyOn(settingsStore, 'updateWebAccess').mockResolvedValue(false);
    const notificationStore = useNotificationStore();

    const wrapper = mountSection();
    await wrapper.findAll('.checkbox-stub')[0]!.trigger('click');
    const selects = wrapper.findAllComponents(AppSelect);
    await selects[0]!.vm.$emit('update:modelValue', 'brave');
    await selects[1]!.vm.$emit('update:modelValue', 'auto-summary');
    const braveInput = wrapper.findAll('input').find(input => input.element.getAttribute('type') === 'password');
    await braveInput?.setValue('BSA_test');
    await wrapper.get('form').trigger('submit');

    expect(updateWebAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        webSearchEnabled: false,
        provider: 'brave',
        workflow: 'auto-summary',
        braveApiKey: 'BSA_test'
      })
    );
    expect(notificationStore.items).not.toContainEqual(
      expect.objectContaining({ kind: 'success', title: '联网能力设置已保存' })
    );
  });

  it('notifies success exactly once after saving web access settings', async () => {
    const settingsStore = useSettingsStore();
    settingsStore.state = createSettingsState() as any;
    const updateWebAccess = vi.spyOn(settingsStore, 'updateWebAccess').mockResolvedValue(true);
    const notificationStore = useNotificationStore();

    const wrapper = mountSection();
    await wrapper.findAll('.checkbox-stub')[0]!.trigger('click');
    const selects = wrapper.findAllComponents(AppSelect);
    await selects[0]!.vm.$emit('update:modelValue', 'brave');
    await selects[1]!.vm.$emit('update:modelValue', 'auto-summary');
    const braveInput = wrapper.findAll('input').find(input => input.element.getAttribute('type') === 'password');
    await braveInput?.setValue('BSA_test');
    await wrapper.get('form').trigger('submit');

    expect(updateWebAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        webSearchEnabled: false,
        provider: 'brave',
        workflow: 'auto-summary',
        braveApiKey: 'BSA_test'
      })
    );
    const successNotifications = notificationStore.items.filter(
      item => item.kind === 'success' && item.title === '联网能力设置已保存'
    );
    expect(successNotifications).toHaveLength(1);
  });

  it('resets to safe defaults without mutating the persisted store state until save', async () => {
    const settingsStore = useSettingsStore();
    settingsStore.state = createSettingsState({
      provider: 'tavily',
      workflow: 'summary-review',
      webSearchEnabled: false
    }) as any;
    const updateWebAccess = vi.spyOn(settingsStore, 'updateWebAccess').mockResolvedValue(true);

    const wrapper = mountSection();
    await wrapper
      .findAll('button')
      .find(button => button.text().includes('恢复安全默认值'))!
      .trigger('click');
    await wrapper.get('form').trigger('submit');

    expect(settingsStore.state?.webAccess.provider).toBe('tavily');
    expect(updateWebAccess).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'auto', workflow: 'none', webSearchEnabled: true })
    );
  });
});
