import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';

import { useAutosizeTextarea } from '../useAutosizeTextarea';

const textareaStyle = {
  boxSizing: 'border-box',
  fontSize: '16px',
  lineHeight: '20px',
  paddingTop: '4px',
  paddingBottom: '4px',
  borderTopWidth: '1px',
  borderBottomWidth: '1px'
};

function setScrollHeight(textarea: HTMLTextAreaElement, value: number) {
  Object.defineProperty(textarea, 'scrollHeight', {
    configurable: true,
    value
  });
}

beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    boxSizing: 'border-box',
    fontSize: '16px',
    lineHeight: '20px',
    paddingTop: '4px',
    paddingBottom: '4px',
    borderTopWidth: '1px',
    borderBottomWidth: '1px'
  } as CSSStyleDeclaration);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAutosizeTextarea', () => {
  it('limits visible rows and enables scrolling after reaching the maximum height', () => {
    let resize!: () => void;
    const wrapper = mount(
      defineComponent({
        setup() {
          const textarea = ref<HTMLTextAreaElement | null>(null);
          ({ resize } = useAutosizeTextarea(textarea, { maxRows: 3 }));
          return () => h('textarea', { ref: textarea, style: textareaStyle });
        }
      })
    );
    const textarea = wrapper.get('textarea').element;

    setScrollHeight(textarea, 120);
    resize();

    expect(textarea.style.height).toBe('70px');
    expect(textarea.style.overflowY).toBe('auto');
  });

  it('supports an element getter and resizes after external value changes', async () => {
    const value = ref('');
    let textareaElement: HTMLTextAreaElement | null = null;
    const wrapper = mount(
      defineComponent({
        setup() {
          useAutosizeTextarea(() => textareaElement, { value });
          return () =>
            h('textarea', {
              ref: (element: unknown) => {
                textareaElement = element as HTMLTextAreaElement | null;
              },
              value: value.value,
              style: textareaStyle
            });
        }
      })
    );
    const textarea = wrapper.get('textarea').element;

    setScrollHeight(textarea, 48);
    value.value = 'updated externally';
    await nextTick();

    expect(textarea.style.height).toBe('50px');
    expect(textarea.style.overflowY).toBe('hidden');
  });
});
