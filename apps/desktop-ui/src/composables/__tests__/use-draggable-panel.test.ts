import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';

import { useDraggablePanel, type ResizeDirection } from '../useDraggablePanel';

function createPointerEventLike(
  overrides: Partial<PointerEvent> & { closest?: (selector: string) => Element | null } = {}
) {
  const capture = vi.fn();
  const release = vi.fn();
  return {
    clientX: 100,
    clientY: 100,
    pointerId: 1,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    target: { closest: overrides.closest ?? vi.fn(() => null) },
    currentTarget: { setPointerCapture: capture, releasePointerCapture: release },
    ...overrides,
    capture,
    release
  } as unknown as PointerEvent & { capture: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
}

function mountComposable() {
  let panel!: ReturnType<typeof useDraggablePanel>;
  const wrapper = mount(
    defineComponent({
      setup() {
        panel = useDraggablePanel({
          initialX: 80,
          initialY: 60,
          initialWidth: 400,
          initialHeight: 300,
          minX: 16,
          minY: 16,
          minWidth: 200,
          minHeight: 160,
          viewportPadding: 16
        });
        return () => null;
      }
    })
  );
  return { wrapper, panel };
}

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1024);
  vi.stubGlobal('innerHeight', 768);
});

describe('useDraggablePanel', () => {
  it('initializes style and clamps the panel into the viewport on mount and resize', async () => {
    vi.stubGlobal('innerWidth', 500);
    vi.stubGlobal('innerHeight', 360);
    const addEventListener = vi.spyOn(window, 'addEventListener');
    const removeEventListener = vi.spyOn(window, 'removeEventListener');

    const { wrapper, panel } = mountComposable();
    await nextTick();

    expect(panel.panelStyle.value).toEqual(expect.objectContaining({ width: '400px', height: '284px' }));
    expect(panel.panelStyle.value.transform).toMatch(/^translate\(\d+px, \d+px\)$/);
    expect(addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));

    wrapper.unmount();
    expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('drags from the header and ignores interactive descendants', () => {
    const { panel } = mountComposable();
    const ignored = createPointerEventLike({ closest: vi.fn(() => document.createElement('button')) });

    panel.handlePointerDown(ignored);
    panel.handlePointerMove(createPointerEventLike({ clientX: 200, clientY: 200 }));
    expect(panel.position).toEqual({ x: 80, y: 60 });

    const down = createPointerEventLike({ clientX: 100, clientY: 100 });
    panel.handlePointerDown(down);
    panel.handlePointerMove(createPointerEventLike({ clientX: 180, clientY: 150 }));
    panel.handlePointerUp(createPointerEventLike());

    expect(down.capture).toHaveBeenCalledWith(1);
    expect(panel.position).toEqual({ x: 160, y: 110 });
  });

  it.each<[ResizeDirection, { x: number; y: number; width: number; height: number }]>([
    ['se', { x: 80, y: 60, width: 500, height: 380 }],
    ['nw', { x: 180, y: 140, width: 300, height: 220 }],
    ['e', { x: 80, y: 60, width: 500, height: 300 }],
    ['s', { x: 80, y: 60, width: 400, height: 380 }],
    ['w', { x: 180, y: 60, width: 300, height: 300 }],
    ['n', { x: 80, y: 140, width: 400, height: 220 }]
  ])('resizes towards %s while respecting minimum size and viewport bounds', (direction, expected) => {
    const { panel } = mountComposable();
    const down = createPointerEventLike({ clientX: 100, clientY: 100 });

    panel.handleResizePointerDown(direction, down);
    panel.handleResizePointerMove(createPointerEventLike({ clientX: 200, clientY: 180 }));
    panel.handleResizePointerUp(createPointerEventLike());

    expect(down.preventDefault).toHaveBeenCalled();
    expect(down.stopPropagation).toHaveBeenCalled();
    expect(panel.position).toEqual({ x: expected.x, y: expected.y });
    expect(panel.size).toEqual({ width: expected.width, height: expected.height });
  });
});
