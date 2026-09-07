<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppInput } from '@/components/AppInput';
import { AppNumberInput } from '@/components/AppNumberInput';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTextarea } from '@/components/AppTextarea';
import { AppTooltip } from '@/components/AppTooltip';
import { useEditorStore } from '@/features/editor';
import { useWorkspaceStore } from '@/features/workspace';
import { useWritingStore } from '@/features/writing';

import { useLibraryStore } from '../store';

const library = useLibraryStore();
const editor = useEditorStore();
const workspace = useWorkspaceStore();
const writing = useWritingStore();
const query = ref('');
const visibleLimit = ref(80);
const candidates = computed(() =>
  library.available.filter(
    asset =>
      !library.selections.some(selection => selection.sourcePath === asset.sourcePath) &&
      `${asset.title} ${asset.sourcePath}`.toLowerCase().includes(query.value.toLowerCase())
  )
);
watch(query, () => {
  visibleLimit.value = 80;
});
const overBudget = computed(() => (library.pack?.chars ?? 0) > library.budgetChars);
const selectedSections = computed(() =>
  library.selections.flatMap(selection => {
    const section = library.pack?.sections.find(value => value.sourcePath === selection.sourcePath);
    return section ? [Object.assign({}, section, selection)] : [];
  })
);
const sections = (pinned: boolean) => selectedSections.value.filter(section => section.pinned === pinned);
watch(
  () => [workspace.rootPath, workspace.revision],
  () => {
    void library.refresh();
  },
  { immediate: true }
);
</script>

<template>
  <section class="reference-panel" aria-label="本次写作参考">
    <header class="reference-header">
      <span>本次写作参考</span>
      <AppTooltip text="重组参考"
        ><AppButton
          icon
          size="xs"
          variant="ghost"
          aria-label="重组参考"
          :disabled="library.loading"
          @click="library.refresh"
        >
          <span class="i-mingcute-refresh-3-line size-3.5" aria-hidden="true" /> </AppButton
      ></AppTooltip>
    </header>
    <AppScrollArea class="reference-scroll">
      <div class="reference-content">
        <p v-if="!workspace.rootPath">尚未打开工作区</p>
        <label class="reference-field"
          >场景<AppSelect
            aria-label="写作场景"
            :model-value="library.scenePath ?? '__temporary'"
            @update:model-value="library.useScene($event === '__temporary' ? undefined : $event)"
          >
            <AppSelectItem value="__temporary">临时写作目标</AppSelectItem>
            <AppSelectItem
              v-for="asset in library.available.filter(value => value.kind === 'scene-card')"
              :key="asset.sourcePath"
              :value="asset.sourcePath"
            >
              {{ asset.title }}
            </AppSelectItem>
          </AppSelect></label
        >
        <p v-if="library.chapterPath" class="reference-meta">目标章节：{{ library.chapterPath }}</p>
        <details v-if="library.sceneDiagnostics.length">
          <summary>未采用来源 · {{ library.sceneDiagnostics.length }}</summary>
          <p v-for="message in library.sceneDiagnostics" :key="message">{{ message }}</p>
        </details>
        <label class="reference-field"
          >写作目标<AppTextarea v-model="library.goal" :rows="3" aria-label="写作目标" />
        </label>
        <div class="reference-budget" :class="{ 'is-over': overBudget }">
          <span>{{ library.pack?.chars ?? 0 }} 字 · 约 {{ library.pack?.tokens ?? 0 }} tokens</span>
          <label
            >预算<AppNumberInput
              :model-value="library.budgetChars"
              :min="100"
              :max="1000000"
              aria-label="参考字数预算"
              class="reference-budget-input"
              @update:model-value="library.budgetChars = $event ?? 9000"
          /></label>
        </div>
        <p v-if="library.error" role="alert">{{ library.error }}</p>
        <div v-if="library.error" class="reference-unreadable">
          <div
            v-for="selection in library.selections.filter(
              value => !library.pack?.sections.some(section => section.sourcePath === value.sourcePath)
            )"
            :key="selection.sourcePath"
          >
            <span>{{ selection.sourcePath }}</span
            ><AppButton
              icon
              size="xs"
              variant="ghost"
              :aria-label="`移除 ${selection.sourcePath}`"
              title="移除参考"
              @click="library.remove(selection.sourcePath)"
              ><span class="i-mingcute-close-line size-3.5"
            /></AppButton>
          </div>
        </div>
        <p v-if="library.freshness?.stale" class="reference-stale" role="status">来源已更新</p>
        <div v-for="pinned in [true, false]" :key="String(pinned)" class="reference-section">
          <h3>
            {{ pinned ? '已固定' : '自动选择' }} <span>{{ sections(pinned).length }}</span>
          </h3>
          <article
            v-for="section in sections(pinned)"
            :key="section.sourcePath"
            class="reference-item"
            :class="{ 'is-largest': overBudget && library.largest === section.sourcePath }"
          >
            <div class="reference-item-heading">
              <AppButton
                variant="link"
                class="reference-source"
                :title="section.sourcePath"
                @click="editor.openDocument(section.sourcePath)"
              >
                {{ section.title }}
              </AppButton>
              <AppTooltip :text="section.pinned ? '取消固定' : '固定参考'"
                ><AppButton
                  icon
                  size="xs"
                  variant="ghost"
                  :aria-label="`${section.pinned ? '取消固定' : '固定'} ${section.title}`"
                  :aria-pressed="section.pinned"
                  @click="
                    library.selections.find(item => item.sourcePath === section.sourcePath)!.pinned = !section.pinned
                  "
                >
                  <span class="i-mingcute-pin-line size-3.5" aria-hidden="true" /> </AppButton
              ></AppTooltip>
              <AppTooltip text="移除参考"
                ><AppButton
                  icon
                  size="xs"
                  variant="ghost"
                  :aria-label="`移除 ${section.title}`"
                  @click="library.remove(section.sourcePath)"
                >
                  <span class="i-mingcute-close-line size-3.5" aria-hidden="true" /> </AppButton
              ></AppTooltip>
            </div>
            <div class="reference-meta">
              {{ section.chars }} 字 · {{ new Date(section.updatedAt).toLocaleString() }}
              <span v-if="section.reason"> · {{ section.reason }}</span>
            </div>
            <label class="reference-mode"
              ><AppCheckbox
                :model-value="section.mode === 'summary'"
                @update:model-value="
                  library.selections.find(item => item.sourcePath === section.sourcePath)!.mode =
                    $event === true ? 'summary' : 'full'
                "
              />要点模式</label
            >
            <details>
              <summary>原文</summary>
              <pre>{{ section.content }}</pre>
            </details>
          </article>
        </div>
        <section class="reference-section">
          <AppButton v-if="library.excluded.length" size="xs" variant="ghost" @click="library.restoreExcluded"
            >恢复已移除建议（{{ library.excluded.length }}）</AppButton
          >
          <h3>
            未采用建议 <span>{{ candidates.length }}</span>
          </h3>
          <AppInput v-model="query" placeholder="筛选来源" aria-label="筛选参考来源" />
          <p v-if="library.loading" role="status">正在读取资产…</p>
          <div v-for="asset in candidates.slice(0, visibleLimit)" :key="asset.sourcePath" class="reference-candidate">
            <AppButton
              variant="link"
              :title="asset.sourcePath"
              class="reference-candidate-link"
              @click="editor.openDocument(asset.sourcePath)"
            >
              {{ asset.title }}<small>{{ asset.sourcePath }}</small>
            </AppButton>
            <AppTooltip text="加入参考"
              ><AppButton
                icon
                size="xs"
                variant="ghost"
                :aria-label="`加入参考 ${asset.title}`"
                @click="library.add(asset.sourcePath)"
              >
                <span class="i-mingcute-add-line size-3.5" aria-hidden="true" /> </AppButton
            ></AppTooltip>
          </div>
          <AppButton v-if="candidates.length > visibleLimit" size="xs" variant="ghost" @click="visibleLimit += 80"
            >显示更多（{{ candidates.length - visibleLimit }}）</AppButton
          >
        </section>
      </div>
    </AppScrollArea>
    <footer class="reference-footer">
      <AppButton size="sm" :disabled="!editor.activeTab || library.busy" @click="writing.prepare()"
        >生成候选稿</AppButton
      >
      <span v-if="library.frozen" role="status">已冻结 {{ library.frozen.id.slice(0, 8) }}</span>
      <AppButton
        size="sm"
        :disabled="library.busy || !workspace.rootPath || (!library.goal.trim() && !library.selections.length)"
        @click="library.freeze"
        >冻结参考</AppButton
      >
    </footer>
  </section>
</template>

<style scoped lang="scss">
.reference-panel {
  @apply flex min-h-0 flex-1 flex-col;
  font-size: var(--ui-font-size);
}
.reference-header {
  @apply flex h-9 shrink-0 items-center justify-between border-b px-3;
  border-color: var(--border-subtle);
}
.reference-scroll {
  @apply min-h-0 flex-1;
}
.reference-content {
  @apply flex min-w-0 flex-col gap-4 p-3;
}
.reference-field {
  @apply flex flex-col gap-2;
}
.reference-unreadable > div {
  @apply flex min-w-0 items-center gap-1;
}
.reference-unreadable span {
  @apply min-w-0 flex-1;
  overflow-wrap: anywhere;
}
.reference-budget {
  @apply flex flex-wrap items-center justify-between gap-2;
  color: var(--muted-foreground);
}
.reference-budget label {
  @apply flex items-center gap-2;
}
.reference-budget-input {
  @apply w-26;
}
.reference-section h3 {
  @apply mb-2 flex items-center justify-between font-medium;
  font-size: var(--ui-font-size);
}
.reference-item {
  @apply border-b py-2;
  border-color: var(--border-subtle);
  overflow-wrap: anywhere;
}
.reference-item-heading {
  @apply flex min-w-0 items-center gap-1;
}
.reference-source {
  @apply min-w-0 flex-1 justify-start truncate border-0 bg-transparent text-left;
  color: var(--foreground);
}
.reference-meta {
  @apply my-1 text-xs;
  color: var(--muted-foreground);
}
.reference-mode {
  @apply mb-1 flex items-center gap-1;
}
.reference-item pre {
  @apply max-h-64 overflow-auto whitespace-pre-wrap p-2 text-xs;
  background: var(--surface-muted);
}
.reference-candidate {
  @apply flex min-w-0 items-center gap-1 border-b py-2;
  border-color: var(--border-subtle);
}
.reference-candidate-link {
  @apply block min-w-0 flex-1 truncate border-0 bg-transparent text-left;
  color: var(--foreground);
}
.reference-candidate small {
  @apply block truncate text-xs;
  color: var(--muted-foreground);
}
.reference-footer {
  @apply flex shrink-0 flex-wrap items-center justify-end gap-2 border-t p-2;
  border-color: var(--border-subtle);
}
.is-over,
.is-largest,
[role='alert'] {
  color: var(--destructive);
}
.reference-stale {
  color: var(--primary-solid);
}
</style>
