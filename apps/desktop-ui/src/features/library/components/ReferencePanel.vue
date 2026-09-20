<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppCollapsible } from '@/components/AppCollapsible';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppInput } from '@/components/AppInput';
import { AppNotice } from '@/components/AppNotice';
import { AppNumberInput } from '@/components/AppNumberInput';
import { AppPanel, AppPanelSection } from '@/components/AppPanel';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTextarea } from '@/components/AppTextarea';
import { AppTextView } from '@/components/AppTextView';
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
const expandedSources = ref(new Map<string, boolean>());
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
const unreadable = computed(() =>
  library.selections.filter(value => !library.pack?.sections.some(section => section.sourcePath === value.sourcePath))
);
const subtitle = computed(() =>
  library.chapterPath ? `目标章节 ${library.chapterPath}` : library.scenePath ? '场景卡未关联章节' : '临时写作目标'
);
function selectionOf(sourcePath: string) {
  return library.selections.find(item => item.sourcePath === sourcePath)!;
}
function timeLabel(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
watch(
  () => [workspace.rootPath, workspace.revision],
  () => {
    void library.refresh();
  },
  { immediate: true }
);
</script>

<template>
  <AppPanel class="reference-panel" title="本次写作参考" title-hidden :subtitle="subtitle">
    <template #actions>
      <AppTooltip text="重组参考" side="bottom" :side-offset="3">
        <AppButton
          icon
          size="xs"
          variant="ghost"
          aria-label="重组参考"
          :disabled="library.loading"
          @click="library.refresh"
        >
          <span class="i-mingcute-refresh-3-line" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
    </template>

    <AppEmptyState
      v-if="!workspace.rootPath"
      icon="i-mingcute-bookmark-line"
      title="尚未打开作品"
      description="打开作品并选中一章正文后，这里组装本次写作要带上的参考。"
    />
    <template v-else>
      <div class="reference-goal">
        <label class="reference-field">
          <span class="reference-field-label">场景</span>
          <AppSelect
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
          </AppSelect>
        </label>
        <label class="reference-field">
          <span class="reference-field-label">写作目标</span>
          <AppTextarea
            v-model="library.goal"
            :rows="3"
            aria-label="写作目标"
            placeholder="这一段要写到哪里、要达成什么"
          />
        </label>
        <div class="reference-budget" :class="{ 'is-over': overBudget }">
          <span class="reference-budget-usage">
            <span
              :class="overBudget ? 'i-mingcute-warning-line' : 'i-mingcute-align-left-line'"
              class="size-3.5"
              aria-hidden="true"
            />
            {{ library.pack?.chars ?? 0 }} 字 · 约 {{ library.pack?.tokens ?? 0 }} tokens
          </span>
          <label class="reference-budget-field">
            预算
            <AppNumberInput
              :model-value="library.budgetChars"
              :min="100"
              :max="1000000"
              aria-label="参考字数预算"
              class="reference-budget-input"
              @update:model-value="library.budgetChars = $event ?? 9000"
            />
          </label>
        </div>
      </div>
      <AppPanelSection
        v-if="library.sceneDiagnostics.length"
        title="未采用来源"
        :count="library.sceneDiagnostics.length"
        :open="false"
      >
        <AppNotice v-for="message in library.sceneDiagnostics" :key="message">{{ message }}</AppNotice>
      </AppPanelSection>
      <AppNotice v-if="library.error" tone="error">{{ library.error }}</AppNotice>
      <div v-if="library.error && unreadable.length" class="reference-unreadable">
        <div v-for="item in unreadable" :key="item.sourcePath" class="reference-unreadable-row">
          <span>{{ item.sourcePath }}</span>
          <AppButton
            icon
            size="xs"
            variant="ghost"
            :aria-label="`移除 ${item.sourcePath}`"
            title="移除参考"
            @click="library.remove(item.sourcePath)"
          >
            <span class="i-mingcute-close-line" />
          </AppButton>
        </div>
      </div>
      <AppNotice v-if="library.freshness?.stale" tone="warning">来源已更新</AppNotice>

      <AppPanelSection
        v-for="pinned in [true, false]"
        :key="String(pinned)"
        :title="pinned ? '已固定' : '自动选择'"
        :count="sections(pinned).length"
      >
        <p v-if="!sections(pinned).length" class="reference-empty">
          {{ pinned ? '在目录树右键「加入写作参考」，或从下方建议里加入。' : '选择场景卡后按写作目标自动选择来源。' }}
        </p>
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
            <AppTooltip :text="section.pinned ? '取消固定' : '固定参考'" side="bottom" :side-offset="3">
              <AppButton
                icon
                size="xs"
                variant="ghost"
                :selected="section.pinned"
                :aria-label="`${section.pinned ? '取消固定' : '固定'} ${section.title}`"
                :aria-pressed="section.pinned"
                @click="selectionOf(section.sourcePath).pinned = !section.pinned"
              >
                <span class="i-mingcute-pin-line" aria-hidden="true" />
              </AppButton>
            </AppTooltip>
            <AppTooltip text="移除参考" side="bottom" :side-offset="3">
              <AppButton
                icon
                size="xs"
                variant="ghost"
                :aria-label="`移除 ${section.title}`"
                @click="library.remove(section.sourcePath)"
              >
                <span class="i-mingcute-close-line" aria-hidden="true" />
              </AppButton>
            </AppTooltip>
          </div>
          <div class="reference-meta">
            <span class="reference-chars">{{ section.chars }} 字</span>
            <span>{{ timeLabel(section.updatedAt) }}</span>
            <span v-if="section.reason">{{ section.reason }}</span>
            <span v-if="overBudget && library.largest === section.sourcePath" class="reference-largest">最大来源</span>
          </div>
          <div class="reference-item-controls">
            <label class="reference-mode">
              <AppCheckbox
                :model-value="section.mode === 'summary'"
                @update:model-value="selectionOf(section.sourcePath).mode = $event === true ? 'summary' : 'full'"
              />
              要点模式
            </label>
            <AppCollapsible
              title="原文"
              variant="plain"
              class="reference-source-toggle"
              :model-value="expandedSources.get(section.sourcePath)"
              @update:model-value="expandedSources.set(section.sourcePath, $event)"
            >
              <AppTextView :text="section.content" :label="`参考原文 ${section.title}`" />
            </AppCollapsible>
          </div>
        </article>
      </AppPanelSection>

      <AppPanelSection title="未采用建议" :count="candidates.length">
        <template #actions>
          <AppButton v-if="library.excluded.length" size="xs" variant="ghost" @click="library.restoreExcluded">
            恢复已移除（{{ library.excluded.length }}）
          </AppButton>
        </template>
        <div class="reference-filter">
          <AppInput v-model="query" placeholder="筛选来源" aria-label="筛选参考来源">
            <template #prefix><span class="i-mingcute-search-line" /></template>
          </AppInput>
        </div>
        <AppNotice v-if="library.loading">正在读取资产…</AppNotice>
        <div v-for="asset in candidates.slice(0, visibleLimit)" :key="asset.sourcePath" class="reference-candidate">
          <AppButton
            variant="link"
            :title="asset.sourcePath"
            class="reference-candidate-link"
            @click="editor.openDocument(asset.sourcePath)"
          >
            <span class="reference-candidate-title">{{ asset.title }}</span>
            <small>{{ asset.sourcePath }}</small>
          </AppButton>
          <AppTooltip text="加入参考" side="bottom" :side-offset="3">
            <AppButton
              icon
              size="xs"
              variant="ghost"
              :aria-label="`加入参考 ${asset.title}`"
              @click="library.add(asset.sourcePath)"
            >
              <span class="i-mingcute-add-line" aria-hidden="true" />
            </AppButton>
          </AppTooltip>
        </div>
        <p v-if="!library.loading && !candidates.length" class="reference-empty">
          {{ query ? '没有匹配的来源' : '所有可用资产都已加入参考' }}
        </p>
        <AppButton
          v-if="candidates.length > visibleLimit"
          size="xs"
          variant="ghost"
          class="reference-more"
          @click="visibleLimit += 80"
        >
          显示更多（{{ candidates.length - visibleLimit }}）
        </AppButton>
      </AppPanelSection>
    </template>

    <template #footer>
      <span v-if="library.frozen" class="app-panel-footer-status" role="status"
        >已冻结 {{ library.frozen.id.slice(0, 8) }}</span
      >
      <AppButton
        size="sm"
        :disabled="library.busy || !workspace.rootPath || (!library.goal.trim() && !library.selections.length)"
        @click="library.freeze"
      >
        冻结参考
      </AppButton>
      <AppButton size="sm" variant="primary" :disabled="!editor.activeTab || library.busy" @click="writing.prepare()">
        生成候选稿
      </AppButton>
    </template>
  </AppPanel>
</template>

<style scoped lang="scss">
.reference-goal {
  @apply flex min-w-0 flex-col gap-3 px-3 pb-3 pt-1;
}
.reference-field {
  @apply flex flex-col gap-1.5;
}
.reference-field-label {
  @apply font-medium;
}
.reference-budget {
  @apply flex flex-wrap items-center justify-between gap-2;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.reference-budget-usage {
  @apply flex items-center gap-1.5;
  font-variant-numeric: tabular-nums;
}
.reference-budget.is-over .reference-budget-usage {
  color: var(--destructive);
}
.reference-budget-field {
  @apply flex items-center gap-2;
}
.reference-budget-input {
  @apply w-26;
}
.reference-unreadable {
  @apply px-3 pb-2;
  font-size: var(--ui-caption-size);
}
.reference-unreadable-row {
  @apply flex min-w-0 items-center gap-1;
}
.reference-unreadable-row span {
  @apply min-w-0 flex-1;
  overflow-wrap: anywhere;
}
.reference-empty {
  @apply m-0 px-5 py-2;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.reference-item {
  @apply flex flex-col gap-1 py-2 pl-5 pr-2;
  overflow-wrap: anywhere;
}
.reference-item + .reference-item {
  border-top: 1px solid var(--border-subtle);
}
.reference-item.is-largest .reference-chars {
  color: var(--destructive);
  font-weight: 600;
}
.reference-item-heading {
  @apply flex min-w-0 items-center gap-0.5;
}
.reference-source {
  @apply min-w-0 flex-1 justify-start border-0 bg-transparent text-left font-medium;
  color: var(--foreground);
}
.reference-meta {
  @apply flex flex-wrap gap-x-2 gap-y-0.5;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  font-variant-numeric: tabular-nums;
}
.reference-largest {
  color: var(--destructive);
}
.reference-item-controls {
  @apply flex flex-wrap items-center gap-x-4 gap-y-1;
}
.reference-mode {
  @apply flex items-center gap-1.5;
  font-size: var(--ui-caption-size);
  color: var(--muted-foreground);
}
.reference-source-toggle {
  @apply min-w-0 flex-1;
}
.reference-source-toggle :deep(.app-collapsible-trigger) {
  @apply w-auto py-0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.reference-source-toggle :deep(.app-collapsible-title) {
  @apply font-normal;
  font-size: var(--ui-caption-size);
}
.reference-source-toggle :deep(.app-collapsible-content) {
  @apply pb-1;
}
.reference-filter {
  @apply px-3 pb-1 pt-1;
}
.reference-candidate {
  @apply flex min-w-0 items-center gap-1 py-1 pl-5 pr-2;
}
.reference-candidate:hover {
  background: var(--surface-hover);
}
.reference-candidate-link {
  @apply flex min-w-0 flex-1 flex-col items-start gap-0 border-0 bg-transparent text-left;
  color: var(--foreground);
}
.reference-candidate-link:hover {
  text-decoration: none;
}
.reference-candidate-title {
  @apply w-full truncate;
}
.reference-candidate small {
  @apply block w-full truncate;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.reference-more {
  @apply mx-3 my-2;
}
</style>
