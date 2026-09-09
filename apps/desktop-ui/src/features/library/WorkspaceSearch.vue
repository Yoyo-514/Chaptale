<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue';

import type { WorkspaceSearchArgs, WorkspaceSearchResult, WorkspaceTextMatch } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppInput } from '@/components/AppInput';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTooltip } from '@/components/AppTooltip';
import { useEditorStore } from '@/features/editor';
import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

const workspace = useWorkspaceStore();
const editor = useEditorStore();
const query = ref('');
const matchCase = ref(false);
const scope = ref<WorkspaceSearchArgs['scope']>('work');
const result = shallowRef<WorkspaceSearchResult>();
const busy = ref(false);
const error = ref('');
let sequence = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
async function search() {
  const token = ++sequence;
  const rootPath = workspace.rootPath;
  clearTimeout(timer);
  if (!rootPath || !query.value.trim()) {
    result.value = undefined;
    busy.value = false;
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    const next = await getDesktopApi().library.search({
      rootPath,
      query: query.value,
      matchCase: matchCase.value,
      scope: scope.value
    });
    if (token === sequence && rootPath === workspace.rootPath) result.value = next;
  } catch (cause) {
    if (token === sequence) {
      result.value = undefined;
      error.value = toErrorMessage(cause);
    }
  } finally {
    if (token === sequence) busy.value = false;
  }
}
async function locate(match: WorkspaceTextMatch) {
  const rootPath = workspace.rootPath;
  await editor.openDocument(match.sourcePath);
  const tab = editor.activeTab;
  if (rootPath !== workspace.rootPath) return;
  if (!tab?.document || tab.document.contentHash !== match.contentHash || tab.dirty || tab.external) {
    error.value = '文件已变化或有未保存内容，请保存后重新搜索';
    return;
  }
  await editor.locate(match.sourcePath, match.from, match.to);
}
watch([query, scope, matchCase, () => workspace.rootPath], () => {
  ++sequence;
  result.value = undefined;
  clearTimeout(timer);
  timer = setTimeout(() => void search(), 250);
});
onBeforeUnmount(() => {
  ++sequence;
  clearTimeout(timer);
});
</script>
<template>
  <section class="workspace-search" aria-label="作品全文搜索">
    <header>
      <h2>搜索</h2>
      <AppTooltip text="重新搜索"
        ><AppButton icon size="xs" variant="ghost" aria-label="重新搜索" :disabled="busy || !query" @click="search"
          ><span class="i-mingcute-refresh-3-line" /></AppButton
      ></AppTooltip>
    </header>
    <form class="search-filters" @submit.prevent="search">
      <AppInput v-model="query" aria-label="搜索作品文本" placeholder="搜索作品文本" :maxlength="200" autofocus>
        <template #suffix
          ><AppTooltip text="区分大小写"
            ><AppButton
              icon
              size="xs"
              variant="ghost"
              aria-label="区分大小写"
              :aria-pressed="matchCase"
              :selected="matchCase"
              @click="matchCase = !matchCase"
              ><span class="i-mingcute-font-size-line" /></AppButton></AppTooltip
        ></template>
      </AppInput>
      <AppSelect v-model="scope" aria-label="搜索范围">
        <AppSelectItem value="work">作品文件</AppSelectItem><AppSelectItem value="manuscript">正文</AppSelectItem>
        <AppSelectItem value="assets">创作资产</AppSelectItem><AppSelectItem value="memory">观察与摘要</AppSelectItem>
      </AppSelect>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="busy" role="status">正在搜索</p>
    <p v-else-if="result" role="status">{{ result.matches.length }} 处匹配 · {{ result.scannedFiles }} 个文件</p>
    <p v-else-if="!workspace.rootPath" role="status">未打开作品</p>
    <AppScrollArea class="search-results">
      <AppButton
        v-for="match in result?.matches"
        :key="`${match.sourcePath}:${match.from}`"
        variant="ghost"
        class="search-match"
        @click="locate(match)"
      >
        <strong
          >{{ match.title }} <small>第 {{ match.line }} 行</small></strong
        >
        <span
          >{{ match.before }}<mark>{{ match.text }}</mark
          >{{ match.after }}</span
        >
        <small>{{ match.sourcePath }}</small>
      </AppButton>
      <p v-if="result?.limited" role="status">结果达到本次搜索上限，请缩小范围或补全关键词。</p>
      <details v-if="result?.diagnostics.length">
        <summary>未搜索的文件与诊断</summary>
        <p v-for="item in result.diagnostics" :key="item">{{ item }}</p>
      </details>
    </AppScrollArea>
  </section>
</template>
<style scoped lang="scss">
.workspace-search {
  @apply flex h-full min-h-0 min-w-0 flex-col;
  font-size: var(--ui-font-size);
}
header {
  @apply flex h-9 shrink-0 items-center gap-1 border-b px-3;
  border-color: var(--border-subtle);
}
h2 {
  @apply m-0 flex-1 font-medium;
  font-size: inherit;
}
.search-filters {
  @apply flex shrink-0 flex-col gap-2 border-b p-3;
  border-color: var(--border-subtle);
}
.search-results {
  @apply min-h-0 flex-1;
}
.search-match {
  @apply h-auto w-full flex-col items-start gap-1 rounded-none border-0 border-b p-3 text-left;
  border-color: var(--border-subtle);
  white-space: normal;
  overflow-wrap: anywhere;
}
.search-match strong {
  @apply font-medium;
}
.search-match small {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.search-match span {
  @apply line-clamp-3;
  font-weight: 400;
}
mark {
  color: var(--selection-foreground, var(--foreground));
  background: var(--selection-background, var(--primary-muted));
}
p,
summary {
  @apply m-0 p-3;
  overflow-wrap: anywhere;
}
[role='alert'] {
  color: var(--destructive);
}
</style>
