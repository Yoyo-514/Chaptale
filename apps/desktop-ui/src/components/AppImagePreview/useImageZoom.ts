import { computed, ref, watch, type CSSProperties, type Ref } from 'vue';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const WHEEL_ZOOM_RATIO = 1.2;
const BUTTON_ZOOM_RATIO = 1.25;
const DOUBLE_CLICK_SCALE = 2.5;

function clampValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 灯箱原图缩放：滚轮/双击以光标为锚，按钮/键盘以视口中心为锚；
 * 放大后可拖拽平移（钳制在视口内），resetKey 变化（切图/关闭）时自动复位。
 */
export function useImageZoom(options: {
  viewportRef: Ref<HTMLElement | null>;
  imageRef: Ref<HTMLImageElement | null>;
  resetKey: Ref<unknown>;
}) {
  const scale = ref(MIN_SCALE);
  const translateX = ref(0);
  const translateY = ref(0);
  const isPanning = ref(false);
  let activePointerId = -1;
  let lastPointerX = 0;
  let lastPointerY = 0;

  const isZoomed = computed(() => scale.value > MIN_SCALE);
  const imageStyle = computed<CSSProperties>(() => ({
    transform: `translate3d(${translateX.value}px, ${translateY.value}px, 0) scale(${scale.value})`,
    // 拖拽必须即时跟手，其余操作用短过渡保持顺滑。
    transition: isPanning.value ? 'none' : 'transform 160ms ease-out'
  }));

  function reset() {
    scale.value = MIN_SCALE;
    translateX.value = 0;
    translateY.value = 0;
    isPanning.value = false;
    activePointerId = -1;
  }

  /** 平移不允许把图片拖出视口；图片小于视口时保持居中。 */
  function clampTranslate(nextScale: number, x: number, y: number) {
    const viewport = options.viewportRef.value;
    const image = options.imageRef.value;

    if (!viewport || !image) {
      return { x: 0, y: 0 };
    }

    const maxX = Math.max(0, (image.clientWidth * nextScale - viewport.clientWidth) / 2);
    const maxY = Math.max(0, (image.clientHeight * nextScale - viewport.clientHeight) / 2);
    return { x: clampValue(x, -maxX, maxX), y: clampValue(y, -maxY, maxY) };
  }

  function applyScale(nextScale: number, anchor?: { clientX: number; clientY: number }) {
    if (!options.imageRef.value) {
      return;
    }

    const clamped = clampValue(nextScale, MIN_SCALE, MAX_SCALE);
    const ratio = clamped / scale.value;

    if (ratio === 1) {
      return;
    }

    let nextX = translateX.value * ratio;
    let nextY = translateY.value * ratio;
    const viewport = options.viewportRef.value;

    if (anchor && viewport) {
      // 保持锚点（光标/双击位置）下的内容在缩放前后不动。
      const rect = viewport.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      nextX = (anchor.clientX - centerX) * (1 - ratio) + translateX.value * ratio;
      nextY = (anchor.clientY - centerY) * (1 - ratio) + translateY.value * ratio;
    }

    const bounded = clampTranslate(clamped, nextX, nextY);
    scale.value = clamped;
    translateX.value = bounded.x;
    translateY.value = bounded.y;
  }

  function zoomIn() {
    applyScale(scale.value * BUTTON_ZOOM_RATIO);
  }

  function zoomOut() {
    applyScale(scale.value / BUTTON_ZOOM_RATIO);
  }

  function onWheel(event: WheelEvent) {
    const ratio = event.deltaY < 0 ? WHEEL_ZOOM_RATIO : 1 / WHEEL_ZOOM_RATIO;
    applyScale(scale.value * ratio, event);
  }

  function onDoubleClick(event: MouseEvent) {
    if (isZoomed.value) {
      applyScale(MIN_SCALE);
    } else {
      applyScale(DOUBLE_CLICK_SCALE, event);
    }
  }

  function onPointerDown(event: PointerEvent) {
    if (!isZoomed.value || event.button !== 0) {
      return;
    }

    event.preventDefault();
    activePointerId = event.pointerId;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    isPanning.value = true;
    options.imageRef.value?.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (!isPanning.value || event.pointerId !== activePointerId) {
      return;
    }

    const next = clampTranslate(
      scale.value,
      translateX.value + event.clientX - lastPointerX,
      translateY.value + event.clientY - lastPointerY
    );
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    translateX.value = next.x;
    translateY.value = next.y;
  }

  function onPointerUp(event: PointerEvent) {
    if (event.pointerId !== activePointerId) {
      return;
    }

    isPanning.value = false;
    activePointerId = -1;
    options.imageRef.value?.releasePointerCapture?.(event.pointerId);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomIn();
    } else if (event.key === '-') {
      event.preventDefault();
      zoomOut();
    } else if (event.key === '0') {
      event.preventDefault();
      reset();
    }
  }

  watch(options.resetKey, reset);

  return {
    scale,
    isZoomed,
    isPanning,
    imageStyle,
    zoomIn,
    zoomOut,
    reset,
    onWheel,
    onDoubleClick,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onKeydown
  };
}
