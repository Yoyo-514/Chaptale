import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import NumberInput from '../NumberInput.vue';

function latestModelValue(wrapper: ReturnType<typeof mount>) {
  return wrapper.emitted('update:modelValue')?.at(-1)?.[0];
}

describe('NumberInput', () => {
  it('emits typed numeric values and keeps the displayed value controlled', async () => {
    const wrapper = mount(NumberInput, { props: { modelValue: 10, min: 1, max: 20 } });

    await wrapper.find('input').setValue('15');

    expect(latestModelValue(wrapper)).toBe(15);
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('15');
  });

  it('clamps values on blur using min and max constraints', async () => {
    const wrapper = mount(NumberInput, { props: { modelValue: 10, min: 1, max: 20 } });

    await wrapper.find('input').setValue('50');
    await wrapper.find('input').trigger('blur');

    expect(latestModelValue(wrapper)).toBe(20);
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('20');
  });

  it('increments and decrements with custom step while respecting disabled edge buttons', async () => {
    const wrapper = mount(NumberInput, { props: { modelValue: 5, min: 0, max: 10, step: 2 } });
    const buttons = wrapper.findAll('.number-input-button');

    await buttons[0].trigger('click');
    expect(latestModelValue(wrapper)).toBe(7);

    await wrapper.setProps({ modelValue: 0 });
    expect(buttons[1].attributes('disabled')).toBeDefined();
  });

  it('emits undefined for intentionally empty optional values', async () => {
    const wrapper = mount(NumberInput, { props: { modelValue: 5 } });

    await wrapper.find('input').setValue('');

    expect(latestModelValue(wrapper)).toBeUndefined();
  });

  it('keeps the previous model value for invalid numeric text', async () => {
    const wrapper = mount(NumberInput, { props: { modelValue: 5 } });

    await wrapper.find('input').setValue('abc');

    expect(latestModelValue(wrapper)).toBe(5);
  });

  it('disables the input and step controls when disabled', () => {
    const wrapper = mount(NumberInput, { props: { modelValue: 5, disabled: true } });

    expect(wrapper.find('input').attributes('disabled')).toBeDefined();
    for (const button of wrapper.findAll('.number-input-button')) {
      expect(button.attributes('disabled')).toBeDefined();
    }
  });
});
