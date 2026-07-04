import { reactive } from 'vue';

export type DraggablePanelOptions = {
  initialX: number;
  initialY: number;
  minX: number;
  minY: number;
  width: number;
  height: number;
};

export function useDraggablePanel(options: DraggablePanelOptions) {
  const position = reactive({ x: options.initialX, y: options.initialY });
  const drag = reactive({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 });

  function handlePointerDown(event: PointerEvent) {
    const target = event.target as HTMLElement;
    if (target.closest('button, input, select, textarea, a')) {
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
    position.x = Math.max(options.minX, Math.min(nextX, window.innerWidth - options.width));
    position.y = Math.max(options.minY, Math.min(nextY, window.innerHeight - options.height));
  }

  function handlePointerUp(event: PointerEvent) {
    if (!drag.active) {
      return;
    }

    drag.active = false;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }

  return {
    position,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp
  };
}
