import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import Button from '../index.vue';

describe('Button', () => {
  it('renders slot content', () => {
    const wrapper = mount(Button, {
      slots: {
        default: '保存'
      }
    });

    expect(wrapper.text()).toBe('保存');
  });

  it('uses button type by default', () => {
    const wrapper = mount(Button);

    expect(wrapper.attributes('type')).toBe('button');
  });

  it('passes disabled state to native button', () => {
    const wrapper = mount(Button, {
      props: {
        disabled: true
      }
    });

    expect(wrapper.attributes()).toHaveProperty('disabled');
  });
});
