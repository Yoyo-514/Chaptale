<script setup lang="ts">
import { computed, nextTick, reactive, ref, shallowRef, watch } from 'vue';

import type {
  ReplaceTextInput,
  ReplaceTextReport,
  TextMatch,
  TextSearchInput,
  TextSearchResult
} from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { AppAlertDialog } from '@/components/AppDialog';
import { AppInput } from '@/components/AppInput';
import { AppTooltip } from '@/components/AppTooltip';
import { requestCreation, useCreationStore } from '@/features/creation';
import { useEditorStore } from '@/features/editor';
import { useWorkbenchStore } from '@/features/workbench';
import { toErrorMessage } from '@/utils/desktop-api';

type Excluded = ReplaceTextInput['excluded'][number];
type Hit = TextMatch & { field: Excluded['field'] };
type Row = {
  id: string;
  title: string;
  documentId: string | undefined;
  kind: 'entry' | 'record' | 'relation';
  matches: Hit[];
};

/** visible 为 false 时面板留着内容但不再搜索，回到面板时按当前文字重新搜。 */
const props = defineProps<{ workId: string; visible: boolean }>();
const creation = useCreationStore();
const editor = useEditorStore();
const navigation = useWorkbenchStore();
const box = ref<HTMLElement>();
const query = ref('');
const replacement = ref('');
const composing = ref(false);
const options = reactive({ caseSensitive: false, wholeWord: false, regexp: false });
const toggles = [
  ['caseSensitive', '区分大小写', 'Aa'],
  ['wholeWord', '全词匹配', 'ab'],
  ['regexp', '正则表达式', '.*']
] as const;
const result = shallowRef<TextSearchResult>();
const error = ref('');
/** 条件已变、新结果还没回来；这时的结果对不上输入框里的内容，不能拿来替换。 */
const searching = ref(false);
/** 作者划掉、替换时保持原文的命中。 */
const kept = ref(new Map<string, Excluded>());
const busy = ref(false);
const confirming = ref(false);
/** 确认框要替换的范围：一行结果，或 null 表示全部。关闭确认框时不清空。 */
const scope = shallowRef<Row | null>(null);
/** 上一次替换或撤销的结果；revisions 还在时可以撤销。 */
const outcome = shallowRef<{
  text: string;
  skippedLabel: string;
  skipped: string[];
  revisions?: ReplaceTextReport['revisions'];
}>();

const request = (): TextSearchInput => ({
  workId: props.workId,
  pattern: query.value,
  ...options,
  unsaved: editor.tabs
    .filter(tab => tab.workId === props.workId && tab.dirty)
    .map(tab => ({ documentId: tab.id, content: editor.getBuffer(tab.id)!.content })),
  replacement: navigation.searchReplace ? replacement.value : null
});
const keyOf = (row: Row, hit: Hit) => `${row.id}:${hit.field}:${hit.line}:${hit.from}`;
const remaining = (row: Row) => row.matches.filter(hit => !kept.value.has(keyOf(row, hit))).length;
const summary = computed(() => {
  if (!result.value) return '';
  const { documentCount, recordCount, total, truncated } = result.value;
  if (!total) return '没有匹配结果';
  const range = [documentCount && `${documentCount} 篇文档`, recordCount && `${recordCount} 条记录`]
    .filter(Boolean)
    .join('、');
  return `${range}中有 ${total} 个结果${truncated ? '，显示前 2000 处' : ''}`;
});
watch(
  () => navigation.searchFocus,
  async () => {
    const state = editor.activeId && editor.selectionState(editor.activeId);
    if (state && !state.selection.main.empty)
      query.value = state.sliceDoc(state.selection.main.from, state.selection.main.to);
    await nextTick();
    const input = box.value?.querySelector('input');
    input?.focus();
    input?.select();
  },
  { immediate: true }
);
const content = () => [
  props.workId,
  query.value,
  ...Object.values(options),
  editor.bufferVersions,
  editor.tabs.map(tab => tab.dirty),
  creation.entries,
  creation.records,
  creation.relations
];
// 文字或搜索条件变了，命中的位置跟着变，划掉的记号不再对得上。
watch(content, () => kept.value.clear());
watch(
  () => [...content(), composing.value, navigation.searchReplace, replacement.value, props.visible],
  (_, __, cleanup) => {
    if (!props.visible) return;
    error.value = '';
    searching.value = !!query.value;
    if (!query.value) result.value = undefined;
    if (!query.value || composing.value) return;
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const response = await requestCreation('searchText', request());
        if (!current) return;
        result.value = response;
        searching.value = false;
      } catch (cause) {
        if (!current) return;
        result.value = undefined;
        searching.value = false;
        error.value = toErrorMessage(cause);
      }
    }, 150);
    cleanup(() => {
      current = false;
      clearTimeout(timer);
    });
  },
  { immediate: true }
);
const groups = computed(() => {
  const sections: Record<'文稿' | '资料' | '事件与关系', Row[]> = { 文稿: [], 资料: [], 事件与关系: [] };
  const entries = new Map(creation.entries.map(e => [e.id, e]));
  for (const hit of result.value?.entries ?? []) {
    const e = entries.get(hit.entryId);
    if (e)
      sections[e.section === 'manuscript' ? '文稿' : '资料'].push({
        id: e.id,
        title: e.title,
        documentId: e.id,
        kind: 'entry',
        matches: hit.matches.map(match => ({ ...match, field: 'content' as const }))
      });
  }
  const records = new Map(creation.records.map(r => [r.id, r]));
  const relations = new Map(creation.relations.map(r => [r.id, r]));
  for (const hit of result.value?.records ?? []) {
    const r = records.get(hit.recordId);
    if (r)
      sections.事件与关系.push({
        id: r.id,
        title: `事件 · ${r.text}`,
        documentId: r.resourceIds.find(id => entries.has(id)),
        kind: 'record',
        matches: hit.matches.map(match => ({ ...match, field: 'text' as const }))
      });
  }
  for (const hit of result.value?.relations ?? []) {
    const r = relations.get(hit.relationId);
    if (r)
      sections.事件与关系.push({
        id: r.id,
        title: `${r.resourceIds.map(id => entries.get(id)?.title ?? '已删除资料').join('、')} · ${r.type}`,
        documentId: r.resourceIds.find(id => entries.has(id)),
        kind: 'relation',
        matches: hit.matches
      });
  }
  return sections;
});
function locate(row: Row, hit: Hit) {
  if (row.documentId)
    void editor.revealDocument(row.documentId, row.kind === 'entry' ? hit : { kind: row.kind, id: row.id });
}
function toggleKept(row: Row, hit: Hit) {
  const key = keyOf(row, hit);
  if (!kept.value.delete(key)) kept.value.set(key, { id: row.id, field: hit.field, line: hit.line, from: hit.from });
}
const rows = computed(() => Object.values(groups.value).flat());
const dirtyIds = computed(() => new Set(editor.tabs.filter(tab => tab.dirty).map(tab => tab.id)));
/** 这次要替换的对象里，有未保存输入的文稿。 */
const unsavedInScope = computed(() =>
  (scope.value ? [scope.value] : rows.value).filter(row => row.kind === 'entry' && dirtyIds.value.has(row.id))
);
const replaceable = computed(() => !!result.value?.total && !searching.value && !busy.value);
const allCount = computed(() => (result.value?.total ?? 0) - kept.value.size);
const confirmTitle = computed(() => {
  const row = scope.value;
  if (!row) return `替换全部 ${allCount.value} 处？`;
  const name = row.kind === 'entry' ? `《${row.title}》` : '这条记录';
  // 结果超过显示上限时，这一行列出的可能不是全部。
  return result.value?.truncated ? `替换${name}里的全部命中？` : `替换${name}里的 ${remaining(row)} 处？`;
});
const confirmDescription = computed(() => {
  const to = replacement.value ? `换成「${replacement.value}」` : '删掉';
  const unsaved = unsavedInScope.value.length;
  return [
    `把「${query.value}」${to}，每篇文档保存为一个新版本。`,
    unsaved ? `其中 ${unsaved} 篇有未保存的输入，会先保存。` : '',
    '替换后可以在这里撤销。'
  ].join('');
});
function ask(row: Row | null) {
  scope.value = row;
  confirming.value = true;
}
function nameOf(id: string) {
  const entry = creation.entries.find(item => item.id === id);
  if (entry) return `《${entry.title}》`;
  const record = creation.records.find(item => item.id === id);
  return record ? `事件「${record.text}」` : `关系「${creation.relations.find(item => item.id === id)?.type ?? ''}」`;
}
async function replace() {
  const only = scope.value;
  // 保存会触发重新搜索并清掉划掉的记号，先把这次要用的条件取出来。
  const unsaved = unsavedInScope.value;
  const search = request();
  const input = {
    workId: props.workId,
    pattern: query.value,
    ...options,
    replacement: replacement.value,
    excluded: [...kept.value.values()].map(({ id, field, line, from }) => ({ id, field, line, from }))
  };
  let { targets } = result.value!;
  busy.value = true;
  error.value = '';
  try {
    if (unsaved.length) {
      for (const row of unsaved)
        if (!(await editor.saveDocument(row.id))) throw new Error(`《${row.title}》没能保存，替换没有进行`);
      targets = (await requestCreation('searchText', { ...search, unsaved: [], replacement: null })).targets;
    }
    const report = await requestCreation('replaceText', {
      ...input,
      commandId: crypto.randomUUID(),
      targets: (only ? targets.filter(target => target.id === only.id) : targets).map(target => ({ ...target }))
    });
    outcome.value = {
      text: `已替换 ${report.count} 处`,
      skippedLabel: '有待接受的修改，没有替换：',
      skipped: report.skipped.map(nameOf),
      revisions: report.revisions.length ? report.revisions : undefined
    };
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
async function undo() {
  busy.value = true;
  error.value = '';
  try {
    const report = await requestCreation('undoReplaceText', {
      commandId: crypto.randomUUID(),
      workId: props.workId,
      revisions: outcome.value!.revisions!.map(revision => ({ ...revision }))
    });
    outcome.value = {
      text: '已撤销上次替换',
      skippedLabel: '替换后又改过，保持现在的内容：',
      skipped: report.skipped.map(nameOf)
    };
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <aside class="work-search" aria-label="全作品搜索">
    <header>搜索</header>
    <div ref="box" class="search-box" @compositionstart="composing = true" @compositionend="composing = false">
      <AppTooltip :text="navigation.searchReplace ? '收起替换' : '展开替换（Ctrl+Shift+H）'">
        <button
          class="replace-toggle"
          :aria-label="navigation.searchReplace ? '收起替换' : '展开替换'"
          :aria-expanded="navigation.searchReplace"
          @click="navigation.searchReplace = !navigation.searchReplace"
        >
          <span
            class="i-mingcute-right-line disclosure"
            :class="{ open: navigation.searchReplace }"
            aria-hidden="true"
          />
        </button>
      </AppTooltip>
      <div class="search-fields">
        <AppInput v-model="query" aria-label="搜索当前作品" placeholder="搜索当前作品" :invalid="!!error">
          <template #suffix
            ><AppTooltip v-for="[key, label, text] in toggles" :key="key" :text="label"
              ><AppButton
                class="search-option"
                variant="ghost"
                size="xs"
                :selected="options[key]"
                :aria-pressed="options[key]"
                :aria-label="label"
                @click="options[key] = !options[key]"
                >{{ text }}</AppButton
              ></AppTooltip
            ></template
          >
        </AppInput>
        <AppInput
          v-if="navigation.searchReplace"
          v-model="replacement"
          aria-label="替换为"
          placeholder="替换为"
          @keydown.enter="replaceable && allCount && ask(null)"
        />
      </div>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-else-if="result" class="summary">
      <p role="status">{{ summary }}</p>
      <AppButton v-if="navigation.searchReplace" size="xs" :disabled="!replaceable || !allCount" @click="ask(null)"
        >全部替换</AppButton
      >
    </div>
    <div v-if="outcome" class="outcome" role="status">
      <span class="outcome-text">{{ outcome.text }}</span>
      <AppButton v-if="outcome.revisions" variant="link" size="xs" :disabled="busy" @click="undo"
        >撤销上次替换</AppButton
      >
      <AppTooltip v-else text="关闭提示">
        <button class="row-action shown" aria-label="关闭提示" @click="outcome = undefined">
          <span class="i-mingcute-close-line" aria-hidden="true" />
        </button>
      </AppTooltip>
      <p v-if="outcome.skipped.length" class="outcome-skipped">
        {{ outcome.skippedLabel }}{{ outcome.skipped.join('、') }}
      </p>
    </div>
    <div class="results">
      <template v-for="(group, label) in groups" :key="label"
        ><section v-if="group.length">
          <h3>{{ label }}</h3>
          <details v-for="row in group" :key="row.id" open>
            <summary>
              <span class="i-mingcute-right-line disclosure" aria-hidden="true" /><span class="result-title">{{
                row.title
              }}</span>
              <AppButton
                v-if="navigation.searchReplace"
                class="row-replace"
                variant="ghost"
                size="xs"
                :disabled="!replaceable || !remaining(row)"
                :aria-label="`替换${row.title}里的命中`"
                @click.prevent="ask(row)"
                >替换</AppButton
              >
              <span class="count">{{ row.matches.length }}</span>
            </summary>
            <div class="match-list">
              <div
                v-for="hit in row.matches"
                :key="keyOf(row, hit)"
                class="hit-row"
                :class="{ kept: kept.has(keyOf(row, hit)) }"
              >
                <button class="hit" :disabled="!row.documentId" @click="locate(row, hit)">
                  <small>{{ hit.line }}</small>{{ hit.excerpt.slice(0, hit.excerptFrom)
                  }}<template v-if="hit.replacement !== undefined && !kept.has(keyOf(row, hit))"
                    ><del>{{ hit.excerpt.slice(hit.excerptFrom, hit.excerptFrom + hit.to - hit.from) }}</del
                    ><ins>{{ hit.replacement }}</ins></template
                  ><mark v-else>{{ hit.excerpt.slice(hit.excerptFrom, hit.excerptFrom + hit.to - hit.from) }}</mark
                  >{{ hit.excerpt.slice(hit.excerptFrom + hit.to - hit.from) }}
                </button>
                <AppTooltip
                  v-if="navigation.searchReplace"
                  :text="kept.has(keyOf(row, hit)) ? '恢复替换这一处' : '这一处保持原文'"
                >
                  <button
                    class="row-action"
                    :aria-label="kept.has(keyOf(row, hit)) ? '恢复替换这一处' : '这一处保持原文'"
                    :aria-pressed="kept.has(keyOf(row, hit))"
                    @click="toggleKept(row, hit)"
                  >
                    <span
                      :class="kept.has(keyOf(row, hit)) ? 'i-mingcute-back-line' : 'i-mingcute-close-line'"
                      aria-hidden="true"
                    />
                  </button>
                </AppTooltip>
              </div>
            </div>
          </details></section
      ></template>
    </div>
    <AppAlertDialog
      v-model:open="confirming"
      :title="confirmTitle"
      :description="confirmDescription"
      :confirm-label="unsavedInScope.length ? '保存并替换' : '替换'"
      @confirm="replace"
    />
  </aside>
</template>
<style scoped>
.work-search {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--sidebar);
  font-size: var(--ui-font-size);
}
header {
  padding: 0 12px;
  line-height: 36px;
  border-bottom: 1px solid var(--border-subtle);
}
.search-box {
  display: flex;
  gap: 2px;
  padding: 8px 8px 8px 4px;
}
.search-fields {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 4px;
}
.replace-toggle,
.row-action {
  display: grid;
  place-items: center;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 4px;
  color: var(--muted-foreground);
  background: transparent;
  cursor: pointer;
}
.replace-toggle {
  width: 18px;
  align-self: stretch;
}
.replace-toggle:hover,
.row-action:hover {
  color: inherit;
  background: var(--surface-hover);
}
.replace-toggle:focus-visible,
.row-action:focus-visible,
.hit:focus-visible {
  outline: 1px solid var(--ring);
  outline-offset: -1px;
}
.search-fields > [data-slot='app-input']:first-child {
  padding-inline-end: 3px;
}
p,
h3 {
  margin: 4px 12px;
  font-size: inherit;
}
p,
small {
  color: var(--muted-foreground);
}
.search-box .search-option {
  width: 24px;
  min-height: 24px;
  height: 24px;
  padding: 0;
}
.results {
  overflow: auto;
  padding: 0 8px 8px;
}
h3 {
  margin: 10px 0 4px;
}
summary,
.hit {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: pointer;
  line-height: 26px;
}
summary {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px;
  list-style: none;
}
summary::-webkit-details-marker {
  display: none;
}
.disclosure {
  width: 14px;
  height: 14px;
  flex: none;
  color: var(--muted-foreground);
}
.disclosure.open,
details[open] > summary .disclosure {
  transform: rotate(90deg);
}
.result-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.summary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 8px 0 12px;
}
.summary p {
  flex: 1;
  margin: 4px 0;
}
.outcome {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin: 4px 8px;
  padding: 4px 4px 4px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-hover);
}
.outcome-text {
  flex: 1;
}
.outcome-skipped {
  flex-basis: 100%;
  margin: 0;
  white-space: normal;
}
.count {
  flex: none;
  min-width: 18px;
  padding: 0 5px;
  border-radius: 9px;
  color: var(--muted-foreground);
  background: var(--surface-hover);
  font-size: 0.85em;
  line-height: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.row-replace {
  flex: none;
  height: 20px;
  min-height: 20px;
  padding: 0 6px;
}
.hit-row {
  display: flex;
  align-items: center;
}
.hit-row .hit {
  flex: 1;
  min-width: 0;
}
.row-action {
  width: 20px;
  height: 20px;
}
/* 行内操作平时收起，悬停或键盘聚焦到这一行时出现；划掉后一直显示，方便恢复。 */
.row-replace,
.row-action:not(.shown) {
  opacity: 0;
}
summary:hover .row-replace,
summary:focus-within .row-replace,
.hit-row:hover .row-action,
.hit-row:focus-within .row-action,
.hit-row.kept .row-action {
  opacity: 1;
}
.hit-row.kept .hit {
  color: var(--muted-foreground);
}
.hit-row:hover {
  background: var(--surface-hover);
}
del {
  color: var(--destructive);
}
ins {
  margin-inline-start: 2px;
  border-radius: 2px;
  background: var(--accent);
  color: var(--accent-foreground);
  text-decoration: none;
}
.match-list {
  margin-inline-start: 11px;
  padding-inline-start: 4px;
  border-inline-start: 1px solid var(--border-subtle);
}
.hit {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0 6px;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  line-height: 24px;
}
.hit:hover,
summary:hover {
  background: var(--surface-hover);
}
small {
  margin-right: 8px;
  font-variant-numeric: tabular-nums;
}
mark {
  background: var(--accent);
  color: var(--accent-foreground);
}
</style>
