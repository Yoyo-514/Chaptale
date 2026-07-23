import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';

import AppForm from '../../AppForm/AppForm.vue';
import AppInput from '../AppInput.vue';

describe('AppInput', () => {
  it('emits string model values from the native input', async () => {
    const wrapper = mount(AppInput, {
      props: {
        modelValue: 'before'
      }
    });

    await wrapper.find('input').setValue('after');

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe('after');
  });

  it('forwards control attributes and merges root classes', () => {
    const wrapper = mount(AppInput, {
      attrs: {
        id: 'provider-name',
        name: 'providerName',
        class: 'custom-input',
        autocomplete: 'off',
        'aria-describedby': 'provider-name-description'
      }
    });

    const input = wrapper.find('input');
    expect(wrapper.classes()).toContain('app-input');
    expect(wrapper.classes()).toContain('custom-input');
    expect(wrapper.attributes('data-slot')).toBe('app-input');
    expect(input.attributes('id')).toBe('provider-name');
    expect(input.attributes('name')).toBe('providerName');
    expect(input.attributes('autocomplete')).toBe('off');
    expect(input.attributes('aria-describedby')).toBe('provider-name-description');
  });

  it('renders prefix and suffix slots without owning their behavior', () => {
    const wrapper = mount(AppInput, {
      slots: {
        prefix: '<span class="search-icon" />',
        suffix: '<button class="clear-button" type="button">清空</button>'
      }
    });

    expect(wrapper.find('[data-slot="app-input-prefix"] .search-icon').exists()).toBe(true);
    expect(wrapper.find('[data-slot="app-input-suffix"] .clear-button').exists()).toBe(true);
  });

  it('inherits disabled state from AppForm', () => {
    const Harness = defineComponent({
      components: { AppForm, AppInput },
      template: '<AppForm disabled><AppInput /></AppForm>'
    });
    const wrapper = mount(Harness);

    expect(wrapper.find('input').attributes()).toHaveProperty('disabled');
    expect(wrapper.find('[data-slot="app-input"]').attributes('data-disabled')).toBe('true');
  });

  it('reflects aria-invalid in component state', () => {
    const wrapper = mount(AppInput, {
      attrs: {
        'aria-invalid': 'true'
      }
    });

    expect(wrapper.attributes('data-invalid')).toBe('true');
    expect(wrapper.find('input').attributes('aria-invalid')).toBe('true');
  });
});
