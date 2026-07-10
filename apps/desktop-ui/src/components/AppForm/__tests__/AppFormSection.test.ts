import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppFormSection from '../AppFormSection.vue';

describe('AppFormSection', () => {
  it('renders section title, description, actions and content', () => {
    const wrapper = mount(AppFormSection, {
      props: {
        title: '供应商信息',
        description: '配置服务地址与访问凭据。'
      },
      slots: {
        actions: '<button type="button">检测连接</button>',
        default: '<div class="field-content">字段</div>'
      }
    });

    expect(wrapper.element.tagName).toBe('SECTION');
    expect(wrapper.find('[data-slot="app-form-section-title"]').text()).toBe('供应商信息');
    expect(wrapper.find('[data-slot="app-form-section-description"]').text()).toBe('配置服务地址与访问凭据。');
    expect(wrapper.find('[data-slot="app-form-section-actions"] button').text()).toBe('检测连接');
    expect(wrapper.find('[data-slot="app-form-section-content"] .field-content').exists()).toBe(true);
  });

  it('supports a disabled fieldset with legend semantics', () => {
    const wrapper = mount(AppFormSection, {
      props: {
        as: 'fieldset',
        title: '高级设置',
        disabled: true
      },
      slots: {
        default: '<input />'
      }
    });

    expect(wrapper.element.tagName).toBe('FIELDSET');
    expect(wrapper.attributes()).toHaveProperty('disabled');
    expect(wrapper.find('legend').text()).toBe('高级设置');
    expect(wrapper.find('input').exists()).toBe(true);
    expect(wrapper.attributes('data-disabled')).toBe('true');
  });

  it('supports custom title and description slots', () => {
    const wrapper = mount(AppFormSection, {
      slots: {
        title: '<span class="custom-title">模型列表</span>',
        description: '<span class="custom-description">可手动添加</span>'
      }
    });

    expect(wrapper.find('.custom-title').exists()).toBe(true);
    expect(wrapper.find('.custom-description').exists()).toBe(true);
  });
});
