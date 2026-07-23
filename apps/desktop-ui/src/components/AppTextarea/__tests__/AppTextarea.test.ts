import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

import AppForm from '../../AppForm/AppForm.vue';
import AppTextarea from '../AppTextarea.vue';

describe('AppTextarea', () => {
  it('emits string model values from the native textarea', async () => {
    const wrapper = mount(AppTextarea, {
      props: {
        modelValue: 'before'
      }
    });

    await wrapper.setValue('after');

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe('after');
  });

  it('forwards native attributes and merges component classes', () => {
    const wrapper = mount(AppTextarea, {
      props: {
        rows: 5,
        resize: 'none',
        variant: 'muted'
      },
      attrs: {
        id: 'message',
        name: 'message',
        class: 'custom-textarea',
        maxlength: '500',
        'aria-describedby': 'message-description'
      }
    });

    expect(wrapper.classes()).toContain('app-textarea');
    expect(wrapper.classes()).toContain('app-textarea-resize-none');
    expect(wrapper.classes()).toContain('app-textarea-muted');
    expect(wrapper.classes()).toContain('custom-textarea');
    expect(wrapper.attributes('rows')).toBe('5');
    expect(wrapper.attributes('id')).toBe('message');
    expect(wrapper.attributes('name')).toBe('message');
    expect(wrapper.attributes('maxlength')).toBe('500');
    expect(wrapper.attributes('aria-describedby')).toBe('message-description');
    expect(wrapper.attributes('data-slot')).toBe('app-textarea');
  });

  it('inherits disabled state from AppForm', () => {
    const Harness = defineComponent({
      components: { AppForm, AppTextarea },
      template: '<AppForm disabled><AppTextarea /></AppForm>'
    });
    const wrapper = mount(Harness);

    expect(wrapper.find('textarea').attributes()).toHaveProperty('disabled');
    expect(wrapper.find('textarea').attributes('data-disabled')).toBe('true');
  });

  it('exposes native focus, select and element access without leaking $el usage', () => {
    const wrapper = mount(AppTextarea, {
      props: {
        variant: 'plain'
      }
    });
    const textarea = wrapper.element as HTMLTextAreaElement;
    const focus = vi.spyOn(textarea, 'focus');
    const select = vi.spyOn(textarea, 'select');

    wrapper.vm.focus();
    wrapper.vm.select();

    expect(wrapper.vm.getElement()).toBe(textarea);
    expect(focus).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledOnce();
    expect(wrapper.classes()).toContain('app-textarea-plain');
  });

  it('reflects explicit invalid state in aria and data attributes', () => {
    const wrapper = mount(AppTextarea, {
      props: {
        invalid: true
      }
    });

    expect(wrapper.attributes('aria-invalid')).toBe('true');
    expect(wrapper.attributes('data-invalid')).toBe('true');
  });
});
