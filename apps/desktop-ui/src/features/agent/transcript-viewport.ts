import { defaultRangeExtractor, elementScroll, useVirtualizer, type VirtualItem } from '@tanstack/vue-virtual';
import { computed, nextTick, onBeforeUnmount, onUpdated, reactive, ref, watch, type Ref } from 'vue';

import type { TranscriptItem } from './transcript';

const rowGap = 4;
const bottomTolerance = 2;

type ReadingAnchor = { key: string; offset: number };

export function createTranscriptMemory() {
  return {
    expanded: reactive(new Set<string>()),
    drafts: reactive(new Map<string, string>()),
    following: true,
    anchor: undefined as ReadingAnchor | undefined,
    measurements: [] as VirtualItem[]
  };
}

export type TranscriptMemory = ReturnType<typeof createTranscriptMemory>;

type TranscriptViewportOptions = {
  viewport: HTMLElement | undefined;
  visible: boolean;
  memory: TranscriptMemory;
};

export function useTranscriptViewport(
  props: TranscriptViewportOptions,
  content: Readonly<Ref<HTMLElement | null>>,
  lane: Readonly<Ref<HTMLElement | null>>,
  items: Readonly<Ref<TranscriptItem[]>>,
  liveStart: Readonly<Ref<number>>,
  outgoingCount: () => number
) {
  const margin = ref(0);
  const viewport = computed(() => (props.visible ? props.viewport : undefined));
  let layoutTop: number | undefined;
  let lastTop = 0;

  function writeScroll(element: HTMLElement, write: () => void) {
    const before = element.scrollTop;
    write();
    if (element.scrollTop !== before) layoutTop = element.scrollTop;
  }

  function followBottom() {
    const element = viewport.value;
    if (!element) return;
    // 实际滚动区的末尾包括等待提示、授权卡和底部留白。
    writeScroll(element, () => {
      element.scrollTop = element.scrollHeight;
    });
  }

  const keys = computed<string[]>(previous => {
    const next = items.value.map(item => item.key);
    return previous?.length === next.length && previous.every((key, index) => key === next[index]) ? previous : next;
  });
  const virtualizer = useVirtualizer<HTMLElement, HTMLElement>(
    computed(() => {
      const messageKeys = keys.value;
      const drafts = props.memory.drafts;
      const retained = messageKeys.flatMap((key, index) =>
        index >= liveStart.value || drafts.has(key) ? [index] : []
      );
      return {
        count: messageKeys.length,
        getScrollElement: () => viewport.value ?? null,
        scrollToFn: (offset, options, instance) => {
          const element = instance.scrollElement;
          if (element) writeScroll(element, () => elementScroll(offset, options, instance));
        },
        getItemKey: index => messageKeys[index]!,
        estimateSize: index => {
          const item = items.value[index]!;
          return item.kind === 'summary' || item.kind === 'notice' ? 38 : 44 + 22 * Math.ceil(item.text.length / 45);
        },
        gap: rowGap,
        scrollMargin: margin.value,
        initialMeasurementsCache: props.memory.measurements,
        overscan: 6,
        anchorTo: 'end',
        scrollEndThreshold: bottomTolerance,
        // 行高变化会更新占位高度；把更新放到下一帧，避免它在尺寸通知期间触发新布局。
        useAnimationFrameWithResizeObserver: true,
        // 当前回合与内联编辑始终保留；滚动时它们的焦点和临时输入仍然有效。
        rangeExtractor: range => [...new Set([...defaultRangeExtractor(range), ...retained])].sort((a, b) => a - b)
      };
    })
  );
  const height = computed(() => virtualizer.value.getTotalSize());
  const rows = computed(() => virtualizer.value.getVirtualItems());

  function trackPosition() {
    const element = viewport.value!;
    const top = element.scrollTop;
    const movedByReader = top !== lastTop && top !== layoutTop;
    lastTop = top;
    layoutTop = undefined;
    // 虚拟器测量后的滚动补偿不改变作者的跟随状态。
    if (!movedByReader) return;
    props.memory.following = element.scrollHeight - top - element.clientHeight <= bottomTolerance;
    const row = virtualizer.value.getVirtualItemForOffset(top);
    props.memory.anchor = row && { key: String(row.key), offset: top - row.start };
  }

  function restorePosition() {
    const { following, anchor } = props.memory;
    const index = !following && anchor ? keys.value.indexOf(anchor.key) : -1;
    if (index !== -1) {
      const [offset] = virtualizer.value.getOffsetForIndex(index, 'start')!;
      virtualizer.value.scrollToOffset(offset + anchor!.offset, { align: 'start' });
      return;
    }
    props.memory.following = true;
    followBottom();
  }

  watch(
    [viewport, content],
    async ([element, root], _, onCleanup) => {
      if (!element || !root) return;
      const updateMargin = () => {
        const list = lane.value;
        if (list) {
          margin.value =
            list.getBoundingClientRect().top -
            element.getBoundingClientRect().top +
            element.scrollTop -
            element.clientTop;
        }
      };
      let frame: number | undefined;
      const observer = new ResizeObserver(() => {
        if (frame !== undefined) return;
        frame = requestAnimationFrame(() => {
          frame = undefined;
          updateMargin();
          if (props.memory.following) followBottom();
        });
      });
      onCleanup(() => {
        observer.disconnect();
        if (frame !== undefined) cancelAnimationFrame(frame);
        element.removeEventListener('scroll', trackPosition, true);
        layoutTop = undefined;
      });
      updateMargin();
      await nextTick();
      if (viewport.value !== element || content.value !== root) return;
      restorePosition();
      lastTop = element.scrollTop;
      // 在虚拟器的滚动监听器执行位置补偿前记录原始滚动。
      element.addEventListener('scroll', trackPosition, { passive: true, capture: true });
      observer.observe(element);
      observer.observe(root);
    },
    { flush: 'post' }
  );

  watch(
    keys,
    (next, previous) => {
      if (!viewport.value) return;
      const anchor = props.memory.anchor;
      if (props.memory.following) followBottom();
      else if (anchor) {
        const previousIndex = previous.indexOf(anchor.key);
        const index = next.indexOf(anchor.key);
        if (index === previousIndex) return;
        const persistedKey = next[previousIndex];
        // 流式消息落盘会取得原生 ID；它还是作者正在读的同一行。
        if (index === -1 && !anchor.key.startsWith('entry:') && persistedKey?.startsWith('entry:')) {
          props.memory.anchor = { ...anchor, key: persistedKey };
        }
        restorePosition();
      }
    },
    { flush: 'post' }
  );

  watch(
    outgoingCount,
    (count, previous) => {
      if (count <= previous) return;
      props.memory.following = true;
      followBottom();
    },
    { flush: 'post' }
  );

  // 切回时用已测过的行高恢复阅读锚点，缓存只含尺寸与键。
  onBeforeUnmount(() => {
    props.memory.measurements = virtualizer.value.takeSnapshot();
  });
  // Vue 先清 ref 再卸下节点；在更新完成后让测量缓存释放已经离开 DOM 的行。
  onUpdated(() => virtualizer.value.measureElement(null));

  return {
    height,
    rows,
    margin,
    measure: (element: HTMLElement | null) => {
      if (element) virtualizer.value.measureElement(element);
    }
  };
}
