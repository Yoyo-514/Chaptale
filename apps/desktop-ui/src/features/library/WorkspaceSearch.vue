<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';

import type { WorkspaceSearchArgs, WorkspaceSearchResult, WorkspaceTextMatch } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppInput } from '@/components/AppInput';
import { AppListItem } from '@/components/AppListItem';
import { AppNotice } from '@/components/AppNotice';
import { AppPanel, AppPanelSection } from '@/components/AppPanel';
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
/** 结果按文件分组：同一文件的多处命中排在一起，作者扫一眼就知道命中散在几个文件里。 */
const groups = computed(() => {
  const map = new Map<string, { title: string; matches: WorkspaceTextMatch[] }>();
  for (const match of result.value?.matches ?? []) {
    const group = map.get(match.sourcePath) ?? { title: match.title, matches: [] };
    group.matches.push(match);
    map.set(match.sourcePath, group);
  }
  return [...map].map(([sourcePath, group]) => Object.assign({ sourcePath }, group));
});
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
  <AppPanel class="workspace-search" title="搜索" aria-label="作品全文搜索">
    <template #actions>
      <AppTooltip text="重新搜索" side="bottom" :side-offset="3">
        <AppButton icon size="xs" variant="ghost" aria-label="重新搜索" :disabled="busy || !query" @click="search">
          <span class="i-mingcute-refresh-3-line" />
        </AppButton>
      </AppTooltip>
    </template>
    <template #toolbar>
      <form class="app-panel-toolbar-full search-form" @submit.prevent="search">
        <AppInput v-model="query" aria-label="搜索作品文本" placeholder="搜索作品文本" :maxlength="200" autofocus>
          <template #prefix><span class="i-mingcute-search-line" /></template>
          <template #suffix>
            <AppTooltip text="区分大小写" side="bottom" :side-offset="3">
              <AppButton
                icon
                size="xs"
                variant="ghost"
                aria-label="区分大小写"
                :aria-pressed="matchCase"
                :selected="matchCase"
                @click="matchCase = !matchCase"
              >
                <span class="i-mingcute-font-size-line" />
              </AppButton>
            </AppTooltip>
          </template>
        </AppInput>
      </form>
      <AppSelect v-model="scope" aria-label="搜索范围" class="app-panel-toolbar-full">
        <AppSelectItem value="work">作品文件</AppSelectItem>
        <AppSelectItem value="manuscript">正文</AppSelectItem>
        <AppSelectItem value="assets">创作资产</AppSelectItem>
        <AppSelectItem value="memory">观察与摘要</AppSelectItem>
      </AppSelect>
    </template>

    <AppNotice v-if="error" tone="error">{{ error }}</AppNotice>
    <AppNotice v-if="busy">正在搜索</AppNotice>
    <template v-else-if="result">
      <AppNotice>{{ result.matches.length }} 处匹配 · {{ result.scannedFiles }} 个文件</AppNotice>
      <AppPanelSection
        v-for="group in groups"
        :key="group.sourcePath"
        class="search-group"
        :title="group.title"
        :count="group.matches.length"
      >
        <AppListItem
          v-for="match in group.matches"
          :key="`${match.sourcePath}:${match.from}`"
          class="search-match"
          :title="match.title"
          :meta="`${match.sourcePath} · 第 ${match.line} 行`"
          @click="locate(match)"
        >
          <template #description>
            <span
              >{{ match.before }}<mark>{{ match.text }}</mark
              >{{ match.after }}</span
            >
          </template>
        </AppListItem>
      </AppPanelSection>
      <AppEmptyState
        v-if="!result.matches.length"
        title="没有匹配的文本"
        description="换个关键词，或把范围切到别的文件类型。"
      />
      <AppNotice v-if="result.limited" tone="warning">结果达到本次搜索上限，请缩小范围或补全关键词。</AppNotice>
      <AppPanelSection
        v-if="result.diagnostics.length"
        title="未搜索的文件与诊断"
        :count="result.diagnostics.length"
        :open="false"
      >
        <p v-for="item in result.diagnostics" :key="item" class="search-diagnostic">{{ item }}</p>
      </AppPanelSection>
    </template>
    <AppEmptyState
      v-else-if="!workspace.rootPath"
      title="未打开作品"
      description="打开或新建一部作品后即可搜索全文。"
    />
    <AppEmptyState
      v-else
      icon="i-mingcute-search-line"
      title="搜索作品全文"
      description="输入即搜索；结果按文件分组，点击直接定位到正文。"
    />
  </AppPanel>
</template>
<style scoped lang="scss">
.search-form {
  @apply min-w-0;
}
.search-match :deep(.app-list-item-title) {
  @apply sr-only;
}
.search-match :deep(.app-list-item-description) {
  color: var(--foreground);
  font-size: var(--ui-font-size);
}
mark {
  color: var(--selection-foreground);
  background: var(--selection-background);
  border-radius: 2px;
}
.search-diagnostic {
  @apply m-0 px-5 py-1;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  overflow-wrap: anywhere;
}
</style>
