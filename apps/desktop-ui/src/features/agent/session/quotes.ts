import { computed, ref, type Ref } from 'vue';

import type { EditorContext } from '@chaptale/agent-host/protocol';

function cloneContext(context: EditorContext): EditorContext {
  return JSON.parse(JSON.stringify(context)) as EditorContext;
}

/** 按会话草稿键管理待发选区引用芯片与输入框聚焦信号。 */
export function useComposerQuotes(draftKey: Readonly<Ref<string>>) {
  const quotes = ref<Record<string, EditorContext | undefined>>({});
  const focusVersion = ref(0);

  const current = computed(() => quotes.value[draftKey.value]);

  function set(context: EditorContext) {
    quotes.value = { ...quotes.value, [draftKey.value]: cloneContext(context) };
    focusVersion.value += 1;
  }

  function clear(key = draftKey.value) {
    if (!(key in quotes.value)) return;
    const next = { ...quotes.value };
    delete next[key];
    quotes.value = next;
  }

  function migrate(fromKey: string, toKey: string) {
    const existing = quotes.value[fromKey];
    if (!existing) return;
    const next = { ...quotes.value, [toKey]: existing };
    delete next[fromKey];
    quotes.value = next;
  }

  function focus() {
    focusVersion.value += 1;
  }

  return {
    current,
    focusVersion,
    set,
    focus,
    clear,
    migrate
  };
}
