import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppTextView from '../AppTextView.vue';

describe('只读长文本', () => {
  it('以纯文本显示产物，更新内容但不开放编辑', async () => {
    const wrapper = mount(AppTextView, { props: { text: '<script>不执行</script>', label: '原始输出全文' } });
    try {
      expect(wrapper.find('script').exists()).toBe(false);
      expect(wrapper.find('.cm-content').text()).toContain('<script>不执行</script>');
      expect(wrapper.find('.cm-content').attributes('contenteditable')).toBe('false');
      await wrapper.setProps({ text: '更新后的留档' });
      expect(wrapper.find('.cm-content').text()).toContain('更新后的留档');
    } finally {
      wrapper.unmount();
    }
  });
});
