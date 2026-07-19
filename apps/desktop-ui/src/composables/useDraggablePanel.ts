import { computed, onBeforeUnmount, onMounted, reactive } from 'vue';

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export type DraggablePanelOptions = {
  initialX: number;
  initialY: number;
  initialWidth: number;
  initialHeight: number;
  minX: number;
  minY: number;
  minWidth: number;
  minHeight: number;
  viewportPadding: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

/**
 * 管理浮动面板的拖拽与八方向缩放，并始终把可操作区域限制在当前视口内。
 * 窗口尺寸变化时重新钳制位置和大小，防止面板留在屏幕外无法找回。
 */
export function useDraggablePanel(options: DraggablePanelOptions) {
  const position = reactive({ x: options.initialX, y: options.initialY });
  const size = reactive({ width: options.initialWidth, height: options.initialHeight });
  const drag = reactive({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 });
  const resize = reactive({
    active: false,
    direction: 'se' as ResizeDirection,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    originWidth: 0,
    originHeight: 0
  });

  const panelStyle = computed(() => ({
    transform: `translate(${position.x}px, ${position.y}px)`,
    width: `${size.width}px`,
    height: `${size.height}px`
  }));

  function maxPanelWidth(x = position.x) {
    return Math.max(options.minWidth, window.innerWidth - options.viewportPadding - x);
  }

  function maxPanelHeight(y = position.y) {
    return Math.max(options.minHeight, window.innerHeight - options.viewportPadding - y);
  }

  function clampPanelToViewport() {
    size.width = clamp(size.width, options.minWidth, maxPanelWidth(position.x));
    size.height = clamp(size.height, options.minHeight, maxPanelHeight(position.y));
    position.x = clamp(position.x, options.minX, window.innerWidth - options.viewportPadding - size.width);
    position.y = clamp(position.y, options.minY, window.innerHeight - options.viewportPadding - size.height);
  }

  function handlePointerDown(event: PointerEvent) {
    const target = event.target as HTMLElement;
    // 交互控件和缩放手柄拥有自己的指针语义，不能被面板拖拽抢占。
    if (target.closest('button, input, select, textarea, a, [data-panel-resize-handle]')) {
      return;
    }

    drag.active = true;
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    drag.originX = position.x;
    drag.originY = position.y;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!drag.active) {
      return;
    }

    const nextX = drag.originX + event.clientX - drag.startX;
    const nextY = drag.originY + event.clientY - drag.startY;
    position.x = clamp(nextX, options.minX, window.innerWidth - options.viewportPadding - size.width);
    position.y = clamp(nextY, options.minY, window.innerHeight - options.viewportPadding - size.height);
  }

  function handlePointerUp(event: PointerEvent) {
    if (!drag.active) {
      return;
    }

    drag.active = false;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }

  function handleResizePointerDown(direction: ResizeDirection, event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();

    resize.active = true;
    resize.direction = direction;
    resize.startX = event.clientX;
    resize.startY = event.clientY;
    resize.originX = position.x;
    resize.originY = position.y;
    resize.originWidth = size.width;
    resize.originHeight = size.height;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function handleResizePointerMove(event: PointerEvent) {
    if (!resize.active) {
      return;
    }

    const deltaX = event.clientX - resize.startX;
    const deltaY = event.clientY - resize.startY;
    const direction = resize.direction;
    const originRight = resize.originX + resize.originWidth;
    const originBottom = resize.originY + resize.originHeight;

    if (direction.includes('e')) {
      size.width = clamp(resize.originWidth + deltaX, options.minWidth, maxPanelWidth(resize.originX));
    }

    if (direction.includes('s')) {
      size.height = clamp(resize.originHeight + deltaY, options.minHeight, maxPanelHeight(resize.originY));
    }

    // 从西/北侧缩放时固定相对边，只移动起点并由原始边界反推尺寸。
    if (direction.includes('w')) {
      const nextX = clamp(resize.originX + deltaX, options.minX, originRight - options.minWidth);
      position.x = nextX;
      size.width = originRight - nextX;
    }

    if (direction.includes('n')) {
      const nextY = clamp(resize.originY + deltaY, options.minY, originBottom - options.minHeight);
      position.y = nextY;
      size.height = originBottom - nextY;
    }
  }

  function handleResizePointerUp(event: PointerEvent) {
    if (!resize.active) {
      return;
    }

    resize.active = false;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }

  onMounted(() => {
    clampPanelToViewport();
    window.addEventListener('resize', clampPanelToViewport);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('resize', clampPanelToViewport);
  });

  return {
    position,
    size,
    panelStyle,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleResizePointerDown,
    handleResizePointerMove,
    handleResizePointerUp
  };
}
