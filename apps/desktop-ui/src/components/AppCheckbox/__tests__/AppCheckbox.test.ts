import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';

import AppForm from '../../AppForm/AppForm.vue';
import AppFormField from '../../AppForm/AppFormField.vue';
import AppCheckbox from '../AppCheckbox.vue';

describe('AppCheckbox', () => {
  it('forwards field attributes to the checkbox root', () => {
    const wrapper = mount(AppCheckbox, {
      attrs: {
        id: 'supports-image',
        name: 'supportsImage',
        required: true,
        class: 'custom-checkbox',
        'aria-describedby': 'supports-image-description'
      }
    });

    const checkbox = wrapper.find('[data-slot="app-checkbox"]');
    expect(checkbox.classes()).toContain('app-checkbox');
    expect(checkbox.classes()).toContain('custom-checkbox');
    expect(checkbox.attributes('id')).toBe('supports-image');
    expect(checkbox.attributes('aria-describedby')).toBe('supports-image-description');
    expect(wrapper.find('input').attributes('name')).toBe('supportsImage');
  });

  it('works directly with AppFormField control attributes', () => {
    const wrapper = mount(AppFormField, {
      props: {
        controlId: 'enabled',
        label: '启用',
        description: '启用此项功能',
        required: true,
        error: '必须启用'
      },
      slots: {
        default: ({ controlAttrs }: { controlAttrs: Record<string, unknown> }) => h(AppCheckbox, controlAttrs)
      }
    });
    const checkbox = wrapper.find('[data-slot="app-checkbox"]');

    expect(checkbox.attributes('id')).toBe('enabled');
    expect(checkbox.attributes('aria-required')).toBe('true');
    expect(checkbox.attributes('aria-invalid')).toBe('true');
    expect(checkbox.attributes('aria-describedby')).toBe('enabled-description enabled-error');
    expect(checkbox.attributes('data-invalid')).toBe('true');
  });

  it('inherits disabled state from AppForm', () => {
    const Harness = defineComponent({
      components: { AppCheckbox, AppForm },
      template: '<AppForm disabled><AppCheckbox /></AppForm>'
    });
    const wrapper = mount(Harness);

    const checkbox = wrapper.find('[data-slot="app-checkbox"]');
    expect(checkbox.attributes()).toHaveProperty('disabled');
    expect(checkbox.attributes()).toHaveProperty('data-disabled');
  });
});
