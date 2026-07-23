import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';

import AppForm from '../AppForm.vue';
import AppFormField from '../AppFormField.vue';

describe('AppForm', () => {
  it('prevents native submission and emits the submit event', async () => {
    const wrapper = mount(AppForm);

    await wrapper.trigger('submit');

    const event = wrapper.emitted('submit')?.[0]?.[0] as SubmitEvent;
    expect(event).toBeInstanceOf(Event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('forwards native form attributes and merges classes', () => {
    const wrapper = mount(AppForm, {
      props: {
        autocomplete: 'off',
        novalidate: true
      },
      attrs: {
        class: 'custom-form',
        name: 'settings'
      }
    });

    expect(wrapper.classes()).toContain('app-form');
    expect(wrapper.classes()).toContain('custom-form');
    expect(wrapper.attributes('autocomplete')).toBe('off');
    expect(wrapper.attributes('novalidate')).toBeDefined();
    expect(wrapper.attributes('name')).toBe('settings');
    expect(wrapper.attributes('data-slot')).toBe('app-form');
  });

  it('provides disabled state to nested fields', () => {
    const Harness = defineComponent({
      components: { AppForm, AppFormField },
      template: `
        <AppForm disabled>
          <AppFormField label="API Key" v-slot="{ controlAttrs }">
            <input v-bind="controlAttrs" />
          </AppFormField>
        </AppForm>
      `
    });
    const wrapper = mount(Harness);

    expect(wrapper.find('form').attributes('aria-disabled')).toBe('true');
    expect(wrapper.find('input').attributes()).toHaveProperty('disabled');
    expect(wrapper.find('[data-slot="app-form-field"]').attributes('data-disabled')).toBe('true');
  });
});
