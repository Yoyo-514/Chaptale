import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { h } from 'vue';

import AppDialog from '../../AppDialog/AppDialog.vue';
import AppFormField from '../../AppForm/AppFormField.vue';
import AppSelect from '../AppSelect.vue';

const overlayPrimitiveStubs = {
  AppScrollArea: { template: '<div><slot /></div>' },
  DialogClose: { template: '<button><slot /></button>' },
  DialogContent: { template: '<div><slot /></div>' },
  DialogDescription: { template: '<div><slot /></div>' },
  DialogOverlay: { template: '<div />' },
  DialogPortal: { template: '<div><slot /></div>' },
  DialogRoot: { template: '<div><slot /></div>' },
  DialogTitle: { template: '<div><slot /></div>' },
  SelectContent: { template: '<div><slot /></div>' },
  SelectPortal: { template: '<div><slot /></div>' },
  SelectRoot: { template: '<div><slot /></div>' },
  SelectTrigger: { template: '<button><slot /></button>' },
  SelectValue: { template: '<span />' }
};

describe('AppSelect', () => {
  it('forwards trigger attributes and merges classes', () => {
    const wrapper = mount(AppSelect, {
      props: {
        modelValue: 'openai',
        required: true,
        name: 'provider'
      },
      attrs: {
        id: 'provider',
        class: 'custom-select',
        'aria-describedby': 'provider-description'
      }
    });
    const trigger = wrapper.find('[data-slot="app-select"]');

    expect(trigger.classes()).toContain('app-select-trigger');
    expect(trigger.classes()).toContain('custom-select');
    expect(trigger.attributes('id')).toBe('provider');
    expect(trigger.attributes('aria-required')).toBe('true');
    expect(trigger.attributes('aria-describedby')).toBe('provider-description');
  });

  it('works directly with AppFormField control attributes', () => {
    const wrapper = mount(AppFormField, {
      props: {
        controlId: 'api-type',
        label: 'API 类型',
        description: '选择兼容的接口协议',
        required: true,
        error: '请选择 API 类型'
      },
      slots: {
        default: ({ controlAttrs }: { controlAttrs: Record<string, unknown> }) =>
          h(AppSelect, { ...controlAttrs, modelValue: 'openai' })
      }
    });
    const trigger = wrapper.find('[data-slot="app-select"]');

    expect(trigger.attributes('id')).toBe('api-type');
    expect(trigger.attributes('aria-required')).toBe('true');
    expect(trigger.attributes('aria-invalid')).toBe('true');
    expect(trigger.attributes('aria-describedby')).toBe('api-type-description api-type-error');
    expect(trigger.attributes('data-invalid')).toBe('true');
  });

  it('forwards form field attributes through a custom trigger', () => {
    const wrapper = mount(AppSelect, {
      attrs: {
        id: 'custom-select',
        'aria-describedby': 'custom-select-description'
      },
      slots: {
        trigger: ({ triggerClass }: { triggerClass: string }) => h('button', { class: triggerClass }, '选择')
      }
    });
    const trigger = wrapper.find('[data-slot="app-select"]');

    expect(trigger.element.tagName).toBe('BUTTON');
    expect(trigger.attributes('id')).toBe('custom-select');
    expect(trigger.attributes('aria-describedby')).toBe('custom-select-description');
  });

  it('uses the popover layer outside an overlay', () => {
    const wrapper = mount(AppSelect, {
      global: { stubs: overlayPrimitiveStubs }
    });

    expect(wrapper.find('.app-select-content').attributes('style')).toMatch(/z-index: var\(--z-[a-z-]+\)/);
  });

  it('uses the modal control layer when its trigger is inside a dialog', () => {
    const outside = mount(AppSelect, {
      global: { stubs: overlayPrimitiveStubs }
    });
    const inDialog = mount(AppDialog, {
      props: { open: true, title: '自定义供应商' },
      slots: {
        default: () => h(AppSelect)
      },
      global: { stubs: overlayPrimitiveStubs }
    });

    const outsideZIndex = outside.find('.app-select-content').attributes('style') ?? '';
    const dialogZIndex = inDialog.find('.app-select-content').attributes('style') ?? '';

    // 层级必须是设计系统的变量（而非像素值），且 dialog 内必须比外部提升一层。
    expect(dialogZIndex).toMatch(/z-index: var\(--z-[a-z-]+\)/);
    expect(dialogZIndex).not.toBe(outsideZIndex);
  });
});
