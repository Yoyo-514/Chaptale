import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationStore } from '../../../stores/notification';
import { useSettingsStore } from '../../../stores/settings';
import WebAccessSettings from '../sections/WebAccessSettings.vue';

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

const dropdownItemStub = defineComponent({
  emits: ['select'],
  setup(_, { emit, slots }) {
    return () => h('button', { class: 'dropdown-item-stub', onClick: () => emit('select') }, slots.default?.());
  }
});

const numberInputStub = defineComponent({
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
        DropdownMenuRoot: passthrough,
        DropdownMenuTrigger: passthrough,
        DropdownMenuPortal: passthrough,
        DropdownMenuContent: passthrough,
        DropdownMenuItem: dropdownItemStub,
        NumberInput: numberInputStub
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
    expect(wrapper.find('[aria-label="浏览器筛选超时秒数"]').exists()).toBe(true);
  });

  it('updates draft values through controls and saves a cloned web access payload', async () => {
    const settingsStore = useSettingsStore();
    settingsStore.state = createSettingsState() as any;
    const updateWebAccess = vi.spyOn(settingsStore, 'updateWebAccess').mockResolvedValue(undefined as never);
    const notificationStore = useNotificationStore();

    const wrapper = mountSection();
    await wrapper.findAll('.checkbox-stub')[0]!.trigger('click');
    await wrapper
      .findAll('.dropdown-item-stub')
      .find(item => item.text().includes('Brave'))!
      .trigger('click');
    await wrapper
      .findAll('.dropdown-item-stub')
      .find(item => item.text().includes('自动总结'))!
      .trigger('click');
    const braveInput = wrapper.findAll('input').find(input => input.element.getAttribute('type') === 'password');
    await braveInput?.setValue('BSA_test');
    await wrapper.find('button.settings-primary-button').trigger('click');

    expect(updateWebAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        webSearchEnabled: false,
        provider: 'brave',
        workflow: 'auto-summary',
        braveApiKey: 'BSA_test'
      })
    );
    expect(notificationStore.items.at(-1)).toMatchObject({ kind: 'success', title: '联网能力设置已保存' });
  });

  it('resets to safe defaults without mutating the persisted store state until save', async () => {
    const settingsStore = useSettingsStore();
    settingsStore.state = createSettingsState({
      provider: 'tavily',
      workflow: 'summary-review',
      webSearchEnabled: false
    }) as any;
    const updateWebAccess = vi.spyOn(settingsStore, 'updateWebAccess').mockResolvedValue(undefined as never);

    const wrapper = mountSection();
    await wrapper.find('button.settings-secondary-button').trigger('click');
    await wrapper.find('button.settings-primary-button').trigger('click');

    expect(settingsStore.state?.webAccess.provider).toBe('tavily');
    expect(updateWebAccess).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'auto', workflow: 'none', webSearchEnabled: true })
    );
  });
});
