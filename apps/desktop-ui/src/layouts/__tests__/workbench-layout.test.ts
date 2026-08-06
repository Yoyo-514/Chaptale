import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import WorkbenchLayout from '../WorkbenchLayout.vue';

vi.mock('../AgentPanel.vue', () => ({
  default: { template: '<div data-test="agent-panel" />' }
}));

const splitterStubs = {
  SplitterGroup: {
    template: '<div data-test="splitter-group"><slot /></div>'
  },
  SplitterPanel: {
    template: '<div data-test="splitter-panel"><slot /></div>'
  },
  SplitterResizeHandle: {
    template: '<div data-test="splitter-handle" />'
  }
};

describe('WorkbenchLayout', () => {
  it('defines the primary sidebar, editor and auxiliary regions', () => {
    const wrapper = mount(WorkbenchLayout, {
      global: { stubs: splitterStubs }
    });

    expect(wrapper.get('[aria-label="工作区侧栏"]').attributes('aria-label')).toBe('工作区侧栏');
    expect(wrapper.get('[aria-label="编辑器区域"]').attributes('aria-label')).toBe('编辑器区域');
    expect(wrapper.get('[aria-label="辅助栏"]').attributes('aria-label')).toBe('辅助栏');
    expect(wrapper.findAll('[data-test="splitter-panel"]')).toHaveLength(3);
    expect(wrapper.findAll('[data-test="splitter-handle"]')).toHaveLength(2);
    expect(wrapper.get('[data-test="agent-panel"]').attributes('data-test')).toBe('agent-panel');
  });

  it('keeps future auxiliary views visible but disabled', () => {
    const wrapper = mount(WorkbenchLayout, {
      global: { stubs: splitterStubs }
    });
    const tabs = wrapper.findAll('.workbench-auxiliary-bar [role="tab"]');

    expect(tabs.map(tab => tab.text())).toEqual(['Agent', '参考', '审查']);
    expect(tabs[0]?.attributes('aria-selected')).toBe('true');
    expect(tabs[1]?.attributes('disabled')).toBeDefined();
    expect(tabs[2]?.attributes('disabled')).toBeDefined();
  });
});
