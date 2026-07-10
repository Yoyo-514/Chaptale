import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { describe, expect, it } from 'vitest';

import AppForm from '../../AppForm/AppForm.vue';
import AppNumberInput from '../AppNumberInput.vue';

function latestModelValue(wrapper: ReturnType<typeof mount>) {
  return wrapper.emitted('update:modelValue')?.at(-1)?.[0];
}

describe('AppNumberInput', () => {
  it('emits typed numeric values and keeps the displayed value controlled', async () => {
    const wrapper = mount(AppNumberInput, { props: { modelValue: 10, min: 1, max: 20 } });

    await wrapper.find('input').setValue('15');

    expect(latestModelValue(wrapper)).toBe(15);
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('15');
  });

  it('clamps values on blur using min and max constraints', async () => {
    const wrapper = mount(AppNumberInput, { props: { modelValue: 10, min: 1, max: 20 } });

    await wrapper.find('input').setValue('50');
    await wrapper.find('input').trigger('blur');

    expect(latestModelValue(wrapper)).toBe(20);
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('20');
  });

  it('increments and decrements with custom step while respecting disabled edge buttons', async () => {
    const wrapper = mount(AppNumberInput, { props: { modelValue: 5, min: 0, max: 10, step: 2 } });
    const buttons = wrapper.findAll('.app-number-input-button');

    await buttons[0].trigger('click');
    expect(latestModelValue(wrapper)).toBe(7);

    await wrapper.setProps({ modelValue: 0 });
    expect(buttons[1].attributes('disabled')).toBeDefined();
  });

  it('emits undefined for intentionally empty optional values', async () => {
    const wrapper = mount(AppNumberInput, { props: { modelValue: 5 } });

    await wrapper.find('input').setValue('');

    expect(latestModelValue(wrapper)).toBeUndefined();
  });

  it('keeps the previous model value for invalid numeric text', async () => {
    const wrapper = mount(AppNumberInput, { props: { modelValue: 5 } });

    await wrapper.find('input').setValue('abc');

    expect(latestModelValue(wrapper)).toBe(5);
  });

  it('disables the input and step controls when disabled', () => {
    const wrapper = mount(AppNumberInput, { props: { modelValue: 5, disabled: true } });

    expect(wrapper.find('input').attributes('disabled')).toBeDefined();
    for (const button of wrapper.findAll('.app-number-input-button')) {
      expect(button.attributes('disabled')).toBeDefined();
    }
  });

  it('inherits disabled state from AppForm', () => {
    const Harness = defineComponent({
      components: { AppForm, AppNumberInput },
      template: '<AppForm disabled><AppNumberInput /></AppForm>'
    });
    const wrapper = mount(Harness);

    expect(wrapper.find('input').attributes()).toHaveProperty('disabled');
    expect(wrapper.find('[data-slot="app-number-input"]').attributes('data-disabled')).toBe('true');
  });

  it('forwards field attributes to the native input and merges root classes', () => {
    const wrapper = mount(AppNumberInput, {
      attrs: {
        id: 'timeout',
        name: 'timeout',
        class: 'custom-number-input',
        'aria-describedby': 'timeout-description'
      }
    });

    expect(wrapper.classes()).toContain('app-number-input');
    expect(wrapper.classes()).toContain('custom-number-input');
    expect(wrapper.attributes('data-slot')).toBe('app-number-input');
    expect(wrapper.find('input').attributes('id')).toBe('timeout');
    expect(wrapper.find('input').attributes('name')).toBe('timeout');
    expect(wrapper.find('input').attributes('aria-describedby')).toBe('timeout-description');
  });
});
