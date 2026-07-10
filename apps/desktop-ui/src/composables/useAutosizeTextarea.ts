import { onMounted, watch, type Ref, type WatchSource } from 'vue';

export type TextareaElementSource =
  | Ref<HTMLTextAreaElement | null | undefined>
  | (() => HTMLTextAreaElement | null | undefined);

export type UseAutosizeTextareaOptions = {
  /** 最大可见行数；不传时允许无限增长。 */
  maxRows?: number;
  /** 外部内容变化后触发重新计算的响应式数据源。 */
  value?: WatchSource<unknown>;
};

function resolveTextarea(source: TextareaElementSource) {
  return typeof source === 'function' ? source() : source.value;
}

function parsePixels(value: string) {
  return Number.parseFloat(value) || 0;
}

export function useAutosizeTextarea(source: TextareaElementSource, options: UseAutosizeTextareaOptions = {}) {
  function resize() {
    const textarea = resolveTextarea(source);

    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';

    const styles = window.getComputedStyle(textarea);
    const fontSize = parsePixels(styles.fontSize) || 16;
    const lineHeight = parsePixels(styles.lineHeight) || fontSize * 1.25;
    const paddingHeight = parsePixels(styles.paddingTop) + parsePixels(styles.paddingBottom);
    const borderHeight = parsePixels(styles.borderTopWidth) + parsePixels(styles.borderBottomWidth);
    const maxRows = options.maxRows === undefined ? undefined : Math.max(1, options.maxRows);
    const maxScrollHeight = maxRows === undefined ? Number.POSITIVE_INFINITY : lineHeight * maxRows + paddingHeight;
    const scrollHeight = textarea.scrollHeight;
    const nextHeight = Math.min(scrollHeight, maxScrollHeight);
    const borderBoxAdjustment = styles.boxSizing === 'border-box' ? borderHeight : 0;

    textarea.style.height = `${nextHeight + borderBoxAdjustment}px`;
    textarea.style.overflowY = scrollHeight > maxScrollHeight ? 'auto' : 'hidden';
  }

  if (options.value) {
    watch(options.value, resize, { flush: 'post' });
  }

  onMounted(resize);

  return { resize };
}
